//! Metadatos de las instancias del jugador (no confundir con `launcher.rs`,
//! que se encarga de descargar y lanzar el contenido real de cada una).

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::storage;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub version_id: String,
    /// Por ahora solo "vanilla" o "fabric". Forge/NeoForge llegarán después.
    pub loader: String,
    /// Versión concreta del loader (p. ej. de Fabric). `None` para Vanilla,
    /// o para instancias antiguas creadas antes de este campo.
    #[serde(default)]
    pub loader_version: Option<String>,
    pub created_at: i64,
    /// Se pone en `true` la primera vez que se completa una descarga con éxito.
    pub installed: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct InstancesFile {
    instances: Vec<Instance>,
}

fn instances_path() -> std::path::PathBuf {
    storage::app_data_dir().join("instances.json")
}

fn load() -> InstancesFile {
    storage::read_json(&instances_path()).unwrap_or_default()
}

fn save(file: &InstancesFile) -> Result<(), String> {
    storage::write_json(&instances_path(), file).map_err(|e| e.to_string())
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Carpeta de trabajo de una instancia concreta (mundo, resourcepacks, etc.),
/// separada por instancia para que no se pisen entre sí.
pub fn instance_game_dir(instance_id: &str) -> std::path::PathBuf {
    let dir = storage::instances_dir().join(instance_id);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub fn list_instances() -> Vec<Instance> {
    load().instances
}

#[tauri::command]
pub fn create_instance(
    name: String,
    version_id: String,
    loader: String,
    loader_version: Option<String>,
) -> Result<Instance, String> {
    if name.trim().is_empty() {
        return Err("El nombre de la instancia no puede estar vacío.".to_string());
    }

    let loader = match loader.as_str() {
        "fabric" => "fabric",
        "forge" => "forge",
        "neoforge" => "neoforge",
        _ => "vanilla",
    }
    .to_string();
    let loader_version = if loader == "vanilla" { None } else { loader_version };

    let instance = Instance {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        version_id,
        loader,
        loader_version,
        created_at: now_unix(),
        installed: false,
    };

    let mut file = load();
    file.instances.push(instance.clone());
    save(&file)?;
    Ok(instance)
}

#[tauri::command]
pub fn delete_instance(id: String) -> Result<(), String> {
    let mut file = load();
    file.instances.retain(|i| i.id != id);
    save(&file)?;
    let _ = std::fs::remove_dir_all(storage::instances_dir().join(&id));
    Ok(())
}

pub fn get_instance(id: &str) -> Result<Instance, String> {
    load()
        .instances
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| "Instancia no encontrada.".to_string())
}

pub fn mark_installed(id: &str) -> Result<(), String> {
    let mut file = load();
    if let Some(inst) = file.instances.iter_mut().find(|i| i.id == id) {
        inst.installed = true;
    }
    save(&file)
}

/// Abre la carpeta de una instancia (mundo, mods, config...) en el
/// explorador de archivos del sistema — igual que "Abrir carpeta .minecraft"
/// en el launcher oficial, pero por instancia.
#[tauri::command]
pub fn open_instance_folder(app: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = instance_game_dir(&instance_id);
    let path_str = dir.to_string_lossy().to_string();

    app.opener()
        .open_path(&path_str, None::<&str>)
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))
}
