//! Instalación de Forge y NeoForge. A diferencia de Fabric, no reimplemento
//! su sistema interno de "processors" (parcheado binario del cliente de
//! Vanilla) — es demasiado propenso a romperse con cada versión nueva.
//!
//! En su lugar, descargo el instalador oficial y lo ejecuto en modo headless
//! (`java -jar forge-installer.jar --installClient <carpeta>`), apuntando a
//! mi propia carpeta de datos — que ya tiene la misma estructura
//! (`versions/`, `libraries/`) que espera. El propio instalador hace todo el
//! trabajo pesado y deja un `version.json` estándar, que luego leo con el
//! mismo parseo que ya uso para Vanilla.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::PathBuf;
use tauri::Emitter;

use crate::launcher::{download_file, emit_progress, find_java};
use crate::{instances, storage};

fn maven_metadata_url(flavor: &str) -> &'static str {
    if flavor == "neoforge" {
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"
    } else {
        "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"
    }
}

fn installer_url(flavor: &str, game_version: &str, loader_version: &str) -> String {
    if flavor == "neoforge" {
        format!(
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/{loader_version}/neoforge-{loader_version}-installer.jar"
        )
    } else {
        format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{game_version}-{loader_version}/forge-{game_version}-{loader_version}-installer.jar"
        )
    }
}

/// `maven-metadata.xml` es un XML muy simple — evitamos meter un crate de
/// XML entero solo para leer un puñado de etiquetas `<version>`.
fn extract_xml_tag_values(xml: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = vec![];
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after = &rest[start + open.len()..];
        let Some(end) = after.find(&close) else { break };
        out.push(after[..end].to_string());
        rest = &after[end + close.len()..];
    }
    out
}

/// Lista las versiones de Forge o NeoForge compatibles con una versión de
/// Minecraft, más recientes primero.
#[tauri::command]
pub async fn get_forge_versions(flavor: String, game_version: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let xml = client
        .get(maven_metadata_url(&flavor))
        .send()
        .await
        .map_err(|e| format!("No se pudo contactar con el repositorio de {flavor}: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let all = extract_xml_tag_values(&xml, "version");

    let mut matches: Vec<String> = if flavor == "neoforge" {
        // NeoForge usa su propio versionado (p. ej. "21.1.90" para MC
        // 1.21.1): quitamos el "1." inicial de la versión de Minecraft para
        // formar el prefijo a buscar.
        let prefix = format!("{}.", game_version.strip_prefix("1.").unwrap_or(&game_version));
        all.into_iter().filter(|v| v.starts_with(&prefix)).collect()
    } else {
        // Forge usa "{mcversion}-{forgeversion}".
        let prefix = format!("{game_version}-");
        all.into_iter()
            .filter(|v| v.starts_with(&prefix))
            .map(|v| v.strip_prefix(&prefix).unwrap_or(&v).to_string())
            .collect()
    };

    if matches.is_empty() {
        return Err(format!(
            "No hay versiones de {} disponibles para Minecraft {game_version}.",
            if flavor == "neoforge" { "NeoForge" } else { "Forge" }
        ));
    }

    matches.reverse(); // maven-metadata.xml viene en orden ascendente
    Ok(matches)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForgeCache {
    /// El id de versión que generó el instalador (p. ej.
    /// "1.20.1-forge-47.2.0"), usado para leer su `version.json` al lanzar.
    pub effective_version_id: String,
}

fn forge_cache_path(instance_id: &str) -> PathBuf {
    instances::instance_game_dir(instance_id).join("forge-cache.json")
}

pub fn load_cache(instance_id: &str) -> Result<ForgeCache, String> {
    storage::read_json(&forge_cache_path(instance_id)).ok_or_else(|| {
        "Faltan archivos de Forge/NeoForge para esta instancia. Vuelve a descargarla.".to_string()
    })
}

/// Lee `install_profile.json` de dentro del .jar del instalador para saber
/// qué id de versión va a generar, sin tener que adivinarlo.
fn read_target_version_id(installer_path: &PathBuf) -> Result<String, String> {
    let file = std::fs::File::open(installer_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entry = archive
        .by_name("install_profile.json")
        .map_err(|_| "El instalador no tiene install_profile.json (¿descarga corrupta?).".to_string())?;

    let mut contents = String::new();
    entry
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    drop(entry);

    // Detectamos el tipo de archivo en vez de asumir que es un install
    // profile — si algún día un instalador raro nos da otra cosa, esto
    // falla con un mensaje claro en vez de un "missing field" confuso.
    match crate::minecraft::parser::parse_minecraft_json(&contents)? {
        crate::minecraft::parser::MinecraftMetadata::InstallProfile(profile) => Ok(profile.version),
        crate::minecraft::parser::MinecraftMetadata::Vanilla(_) => Err(
            "El archivo install_profile.json de este instalador tiene, inesperadamente, forma de \
             version.json de Vanilla — puede que el instalador esté corrupto o sea de un formato no soportado."
                .to_string(),
        ),
    }
}

/// El instalador oficial de Forge/NeoForge, incluso en modo headless con
/// `--installClient`, se niega a instalar si no encuentra un
/// `launcher_profiles.json` en el directorio de destino — es su forma de
/// comprobar que "esto parece una carpeta de Minecraft de verdad" (si no
/// existe, falla con "There is no minecraft launcher profile...").
///
/// Esto NO es que dependamos del launcher oficial: nuestras propias
/// instancias y perfiles los gestiona `instances.rs`, totalmente aparte, y
/// nunca lee este archivo. Existe únicamente para satisfacer la validación
/// de un programa de terceros que no controlamos.
fn ensure_launcher_profiles_marker(target_dir: &std::path::Path) -> Result<(), String> {
    let path = target_dir.join("launcher_profiles.json");
    if path.exists() {
        return Ok(());
    }
    let minimal = serde_json::json!({
        "profiles": {},
        "settings": {},
        "version": 3
    });
    std::fs::write(&path, serde_json::to_string_pretty(&minimal).map_err(|e| e.to_string())?)
        .map_err(|e| format!("No se pudo crear el marcador launcher_profiles.json que pide el instalador: {e}"))
}

/// Descarga el instalador oficial de Forge/NeoForge y lo ejecuta en modo
/// headless contra la carpeta de datos de la app.
pub async fn install(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    instance_id: &str,
    flavor: &str,
    game_version: &str,
    loader_version: &str,
    required_java_major: Option<u32>,
) -> Result<(), String> {
    let label = if flavor == "neoforge" { "NeoForge" } else { "Forge" };

    emit_progress(app, "forge", 0, 1, &format!("Descargando el instalador de {label}…"));
    let url = installer_url(flavor, game_version, loader_version);
    let installer_path = storage::app_data_dir()
        .join("installers")
        .join(format!("{flavor}-{game_version}-{loader_version}-installer.jar"));
    download_file(client, &url, &installer_path, None).await?;

    let effective_version_id = read_target_version_id(&installer_path)?;

    emit_progress(
        app,
        "forge",
        0,
        1,
        &format!("Ejecutando el instalador oficial de {label} (puede tardar un poco)…"),
    );
    let java_bin = find_java(required_java_major)?;
    ensure_launcher_profiles_marker(&storage::app_data_dir())?;

    let mut command = tokio::process::Command::new(&java_bin);
    command
        .arg("-jar")
        .arg(&installer_path)
        .arg("--installClient")
        .arg(storage::app_data_dir())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("No se pudo lanzar el instalador de {label}: {e}"))?;

    // Antes esto solo se reenviaba como progreso (texto que se pisa línea a
    // línea, nunca se guardaba) y si el instalador fallaba devolvíamos un
    // mensaje inventado por nosotros ("comprueba tu Java"), sin ver lo que
    // el instalador dijo de verdad. Ahora lo guardamos también, para poder
    // mostrar el motivo real si falla — el instalador de Forge/NeoForge sí
    // imprime por qué falla (versión de Java incompatible, directorio de
    // destino no reconocido, jar corrupto, lo que sea), simplemente no lo
    // estábamos mirando.
    let captured: std::sync::Arc<tokio::sync::Mutex<Vec<String>>> =
        std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new()));

    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        let captured = captured.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_progress(&app_clone, "forge", 0, 1, &line);
                captured.lock().await.push(line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let captured = captured.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_progress(&app_clone, "forge", 0, 1, &line);
                captured.lock().await.push(line);
            }
        });
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Error esperando al instalador de {label}: {e}"))?;

    if !status.success() {
        // Puede que los hilos de lectura de arriba aún no hayan terminado
        // de volcar las últimas líneas al buffer justo cuando el proceso
        // reporta su salida — les damos un instante antes de leerlo.
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let lines = captured.lock().await;
        let tail: Vec<&String> = lines.iter().rev().take(20).collect();
        let tail_text: String = tail.into_iter().rev().cloned().collect::<Vec<_>>().join("\n");

        return Err(if tail_text.trim().is_empty() {
            format!(
                "El instalador de {label} terminó con un error (código {}), pero no imprimió \
                 ningún detalle.",
                status.code().map(|c| c.to_string()).unwrap_or_else(|| "desconocido".to_string())
            )
        } else {
            format!("El instalador de {label} terminó con un error:\n{tail_text}")
        });
    }

    let cache = ForgeCache { effective_version_id };
    storage::write_json(&forge_cache_path(instance_id), &cache).map_err(|e| e.to_string())?;
    let _ = app.emit("instances-changed", ());

    Ok(())
}
