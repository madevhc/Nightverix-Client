//! Instalación de Fabric Loader. Sigue el mismo patrón que Vanilla: se
//! descargan las librerías propias de Fabric y se guarda un "cache" con la
//! main class + rutas de librerías resueltas, para no tener que volver a
//! pedirle nada a la red al lanzar el juego.
//!
//! Referencia: https://github.com/FabricMC/fabric-meta

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::launcher::{download_file, emit_progress, libraries_dir};
use crate::minecraft::vanilla::maven_path_from_name;
use crate::{instances, storage};

const FABRIC_META: &str = "https://meta.fabricmc.net/v2";

#[derive(Deserialize)]
struct LoaderListEntry {
    loader: LoaderInfo,
}
#[derive(Deserialize)]
struct LoaderInfo {
    version: String,
    stable: bool,
}

#[derive(Deserialize)]
struct FabricProfile {
    #[serde(rename = "mainClass")]
    main_class: String,
    libraries: Vec<FabricLibraryRaw>,
}

/// Las librerías de Fabric usan el formato "clásico" (nombre maven + URL base
/// del repositorio), distinto al `downloads.artifact` moderno que usa Vanilla.
#[derive(Deserialize)]
struct FabricLibraryRaw {
    name: String,
    url: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FabricCache {
    pub main_class: String,
    pub library_paths: Vec<String>,
}

fn fabric_cache_path(instance_id: &str) -> PathBuf {
    instances::instance_game_dir(instance_id).join("fabric-cache.json")
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersionOption {
    pub version: String,
    pub stable: bool,
}

/// Lista todas las versiones de Fabric Loader disponibles para una versión de
/// Minecraft, más nuevas primero — para que el usuario pueda elegir una en
/// vez de forzar siempre la última estable.
#[tauri::command]
pub async fn get_fabric_loader_versions(game_version: String) -> Result<Vec<LoaderVersionOption>, String> {
    let client = reqwest::Client::new();
    let url = format!("{FABRIC_META}/versions/loader/{}", urlencode(&game_version));
    let entries: Vec<LoaderListEntry> = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo contactar con Fabric Meta: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada de Fabric Meta: {e}"))?;

    if entries.is_empty() {
        return Err(format!("No hay versiones de Fabric Loader disponibles para Minecraft {game_version}."));
    }

    Ok(entries
        .into_iter()
        .map(|e| LoaderVersionOption { version: e.loader.version, stable: e.loader.stable })
        .collect())
}

/// Devuelve la última versión estable de Fabric Loader para una versión de
/// Minecraft dada (la API ya los devuelve ordenados, más nuevo primero).
async fn latest_stable_loader(client: &reqwest::Client, game_version: &str) -> Result<String, String> {
    let url = format!("{FABRIC_META}/versions/loader/{}", urlencode(game_version));
    let entries: Vec<LoaderListEntry> = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo contactar con Fabric Meta: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada de Fabric Meta: {e}"))?;

    entries
        .iter()
        .find(|e| e.loader.stable)
        .or_else(|| entries.first())
        .map(|e| e.loader.version.clone())
        .ok_or_else(|| format!("No hay ninguna versión de Fabric Loader disponible para Minecraft {game_version}."))
}

fn urlencode(s: &str) -> String {
    // Los identificadores de versión de Minecraft no suelen llevar caracteres
    // especiales, pero por si acaso (p. ej. "1.14 Pre-Release 5").
    s.replace(' ', "%20")
}

/// Descarga Fabric Loader completo para una instancia: resuelve la mejor
/// versión de loader, pide el perfil de lanzado, descarga sus librerías y
/// guarda el cache en disco. Emite progreso como el resto de la descarga.
pub async fn install(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    instance_id: &str,
    game_version: &str,
    loader_version: Option<&str>,
) -> Result<(), String> {
    emit_progress(app, "fabric", 0, 1, "Resolviendo versión de Fabric Loader…");
    let loader_version = match loader_version {
        Some(v) => v.to_string(),
        None => latest_stable_loader(client, game_version).await?,
    };

    let profile_url = format!(
        "{FABRIC_META}/versions/loader/{}/{}/profile/json",
        urlencode(game_version),
        urlencode(&loader_version)
    );
    let profile: FabricProfile = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar el perfil de Fabric: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada del perfil de Fabric: {e}"))?;

    let total = profile.libraries.len() as u64;
    let mut library_paths = Vec::with_capacity(profile.libraries.len());

    for (idx, lib) in profile.libraries.iter().enumerate() {
        emit_progress(app, "fabric", idx as u64, total, &lib.name);
        let rel_path = maven_path_from_name(&lib.name);
        let base = lib.url.trim_end_matches('/');
        let url = format!("{base}/{rel_path}");
        let dest = libraries_dir().join(&rel_path);
        // Las librerías de Fabric no traen sha1 en este endpoint — se
        // descargan sin verificación de integridad (solo se saltan si ya
        // existe un archivo en esa ruta).
        download_file(client, &url, &dest, None).await?;
        library_paths.push(rel_path);
    }

    let cache = FabricCache {
        main_class: profile.main_class,
        library_paths,
    };
    storage::write_json(&fabric_cache_path(instance_id), &cache).map_err(|e| e.to_string())?;

    Ok(())
}

/// Lee el cache de Fabric ya instalado para una instancia (usado al lanzar).
pub fn load_cache(instance_id: &str) -> Result<FabricCache, String> {
    storage::read_json(&fabric_cache_path(instance_id)).ok_or_else(|| {
        "Faltan archivos de Fabric para esta instancia. Vuelve a descargarla.".to_string()
    })
}
