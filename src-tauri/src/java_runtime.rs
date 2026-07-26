//! Descarga e instalación automática de Java (Temurin, vía la API pública
//! de Adoptium: https://adoptium.net/temurin/releases/).
//!
//! Cuando `launcher::find_java` no encuentra un Java que cumpla lo que pide
//! la versión de Minecraft, el error que devuelve lleva un marcador
//! `JAVA_MISSING:<major>` que el frontend detecta para ofrecer el botón
//! "Instalar Java automáticamente" — eso llama a `install_java`, que es
//! este módulo.
//!
//! El runtime se guarda en `<datos de la app>/java-runtimes/<major>/` y
//! queda ahí para siempre (no hace falta re-descargarlo en cada lanzado);
//! `launcher::find_java` lo busca ahí como primer candidato antes de mirar
//! el PATH o `JAVA_HOME`.

use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::launcher::{download_file, emit_progress};
use crate::storage;

#[derive(serde::Deserialize)]
struct AdoptiumRelease {
    binary: AdoptiumBinary,
}

#[derive(serde::Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}

#[derive(serde::Deserialize)]
struct AdoptiumPackage {
    link: String,
}

fn adoptium_os() -> Result<&'static str, String> {
    match std::env::consts::OS {
        "windows" => Ok("windows"),
        "macos" => Ok("mac"),
        "linux" => Ok("linux"),
        other => Err(format!(
            "No sé descargar Java automáticamente para este sistema operativo ({other}). \
             Instálalo tú desde https://adoptium.net/temurin/releases/"
        )),
    }
}

fn adoptium_arch() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x64"),
        "aarch64" => Ok("aarch64"),
        "x86" => Ok("x32"),
        other => Err(format!(
            "No sé descargar Java automáticamente para esta arquitectura ({other}). \
             Instálalo tú desde https://adoptium.net/temurin/releases/"
        )),
    }
}

pub fn runtime_root() -> PathBuf {
    let dir = storage::app_data_dir().join("java-runtimes");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Busca `bin/java`/`bin/java.exe` dentro del árbol extraído. No asumimos
/// una profundidad fija a propósito: el .zip de Windows deja el binario en
/// `<paquete>/bin/java.exe`, pero el .tar.gz de macOS lo deja más adentro,
/// en `<paquete>/Contents/Home/bin/java` (estructura de bundle de macOS).
fn find_java_binary_in(root: &Path, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let target_name = if cfg!(windows) { "java.exe" } else { "java" };

    let mut subdirs = vec![];
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some("bin") {
            let candidate = path.join(target_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        subdirs.push(path);
    }
    for dir in subdirs {
        if let Some(found) = find_java_binary_in(&dir, depth - 1) {
            return Some(found);
        }
    }
    None
}

/// Java ya descargado e instalado por nosotros para esta versión mayor, si
/// lo hay.
pub fn managed_java_path(major: u32) -> Option<PathBuf> {
    let dir = runtime_root().join(major.to_string());
    if !dir.exists() {
        return None;
    }
    find_java_binary_in(&dir, 6)
}

pub async fn install(app: &AppHandle, client: &reqwest::Client, major: u32) -> Result<PathBuf, String> {
    let os = adoptium_os()?;
    let arch = adoptium_arch()?;

    emit_progress(app, "java", 0, 1, &format!("Buscando Java {major} (Temurin) para {os}/{arch}…"));

    let api_url = format!(
        "https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type=jre&os={os}&vendor=eclipse"
    );
    let releases: Vec<AdoptiumRelease> = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo consultar Adoptium: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Adoptium no tiene ningún build de Java {major} para {os}/{arch} (o la API cambió de forma): {e}"))?;

    let release = releases
        .into_iter()
        .next()
        .ok_or_else(|| format!("Adoptium no tiene ningún build de Java {major} para {os}/{arch}."))?;
    let download_url = release.binary.package.link;

    let dest_dir = runtime_root().join(major.to_string());
    // Por si quedó a medias de un intento anterior que falló.
    let _ = std::fs::remove_dir_all(&dest_dir);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let archive_ext = if os == "windows" { "zip" } else { "tar.gz" };
    let archive_path = dest_dir.join(format!("temurin-{major}.{archive_ext}"));

    emit_progress(app, "java", 0, 1, &format!("Descargando Temurin {major} ({os}/{arch})…"));
    download_file(client, &download_url, &archive_path, None).await?;

    emit_progress(app, "java", 1, 1, "Extrayendo Java…");
    if os == "windows" {
        let file = std::fs::File::open(&archive_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        archive.extract(&dest_dir).map_err(|e| e.to_string())?;
    } else {
        let file = std::fs::File::open(&archive_path).map_err(|e| e.to_string())?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);
        archive.set_preserve_permissions(true);
        archive.unpack(&dest_dir).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&archive_path);

    find_java_binary_in(&dest_dir, 6).ok_or_else(|| {
        "Java se descargó y se extrajo, pero no se encontró el binario `java` dentro del paquete \
         — el formato del paquete de Adoptium pudo haber cambiado."
            .to_string()
    })
}

#[tauri::command]
pub async fn install_java(app: AppHandle, major_version: u32) -> Result<(), String> {
    let client = reqwest::Client::new();
    install(&app, &client, major_version).await?;
    Ok(())
}
