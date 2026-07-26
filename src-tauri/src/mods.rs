//! Gestión de mods instalados por instancia. La carpeta `mods/` de cada
//! instancia es la fuente de verdad de qué .jar hay instalados; un pequeño
//! manifiesto aparte (`mods-manifest.json`) recuerda qué project_id de
//! Modrinth corresponde a cada archivo, solo para poder marcar "Instalado"
//! en el buscador aunque se reinicie la app.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::instances;
use crate::launcher::download_file;

fn mods_dir(instance_id: &str) -> std::path::PathBuf {
    let dir = instances::instance_game_dir(instance_id).join("mods");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn manifest_path(instance_id: &str) -> PathBuf {
    instances::instance_game_dir(instance_id).join("mods-manifest.json")
}

#[derive(Serialize, Deserialize, Default)]
struct ModManifest {
    /// nombre de archivo -> project_id de Modrinth
    entries: HashMap<String, String>,
}

fn load_manifest(instance_id: &str) -> ModManifest {
    let path = manifest_path(instance_id);
    let Ok(text) = std::fs::read_to_string(&path) else { return ModManifest::default() };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_manifest(instance_id: &str, manifest: &ModManifest) -> Result<(), String> {
    let text = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    std::fs::write(manifest_path(instance_id), text).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub filename: String,
    pub size_bytes: u64,
    pub project_id: Option<String>,
}

#[tauri::command]
pub fn list_installed_mods(instance_id: String) -> Result<Vec<InstalledMod>, String> {
    let dir = mods_dir(&instance_id);
    let manifest = load_manifest(&instance_id);
    let mut mods = vec![];

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(vec![]),
    };

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jar") {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let project_id = manifest.entries.get(&filename).cloned();
        mods.push(InstalledMod { filename, size_bytes, project_id });
    }

    mods.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(mods)
}

/// Descarga un mod (típicamente desde Modrinth) directamente a la carpeta
/// `mods/` de una instancia, y recuerda su project_id en el manifiesto.
#[tauri::command]
pub async fn install_mod(
    app: AppHandle,
    instance_id: String,
    download_url: String,
    filename: String,
    sha1: Option<String>,
    project_id: Option<String>,
) -> Result<(), String> {
    let dest = mods_dir(&instance_id).join(&filename);
    let client = reqwest::Client::new();
    download_file(&client, &download_url, &dest, sha1.as_deref()).await?;

    if let Some(pid) = project_id {
        let mut manifest = load_manifest(&instance_id);
        manifest.entries.insert(filename, pid);
        save_manifest(&instance_id, &manifest)?;
    }

    use tauri::Emitter;
    let _ = app.emit("mods-changed", &instance_id);
    Ok(())
}

#[tauri::command]
pub fn remove_mod(app: AppHandle, instance_id: String, filename: String) -> Result<(), String> {
    let path = mods_dir(&instance_id).join(&filename);
    std::fs::remove_file(&path).map_err(|e| format!("No se pudo quitar el mod: {e}"))?;

    let mut manifest = load_manifest(&instance_id);
    manifest.entries.remove(&filename);
    let _ = save_manifest(&instance_id, &manifest);

    use tauri::Emitter;
    let _ = app.emit("mods-changed", &instance_id);
    Ok(())
}
