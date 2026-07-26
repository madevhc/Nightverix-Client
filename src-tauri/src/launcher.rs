//! Motor de descarga y lanzado de Minecraft: Java Edition (solo Vanilla por ahora).
//!
//! Sigue el mismo protocolo que usa el launcher oficial:
//!   1. `version_manifest_v2.json` → lista de versiones disponibles.
//!   2. El JSON de la versión elegida → librerías, assets, main class y argumentos.
//!   3. Se descargan librerías (filtradas por SO), el asset index + sus objetos,
//!      y el .jar del cliente.
//!   4. Se arma el classpath y los argumentos de Java, y se lanza el proceso.
//!
//! Referencia: https://minecraft.wiki/w/Client.json y https://minecraft.wiki/w/Version_manifest.json

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;

use crate::minecraft::vanilla::{
    current_os_name, maven_path_from_name, rules_allow, ArgValue, ArgValueInner, ExtractRule,
    VersionDetail, VersionManifestSummary, VersionSummary,
};
use crate::{auth, instances, storage};

const VERSION_MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const DEFAULT_MAX_HEAP_MB: u32 = 2048;

// ─── Directorios compartidos (librerías/assets se comparten entre instancias) ─

pub fn versions_dir() -> PathBuf {
    let dir = storage::app_data_dir().join("versions");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
pub fn libraries_dir() -> PathBuf {
    let dir = storage::app_data_dir().join("libraries");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
pub fn assets_dir() -> PathBuf {
    let dir = storage::app_data_dir().join("assets");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
pub fn natives_dir(version_id: &str) -> PathBuf {
    let dir = storage::app_data_dir().join("natives").join(version_id);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

// ─── Manifest de versiones ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct RawManifest {
    latest: RawLatest,
    versions: Vec<RawVersionEntry>,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RawLatest {
    release: String,
    snapshot: String,
}
#[derive(Deserialize, Clone)]
struct RawVersionEntry {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    url: String,
    #[serde(rename = "releaseTime")]
    release_time: String,
}

#[tauri::command]
pub async fn get_version_manifest() -> Result<VersionManifestSummary, String> {
    let client = reqwest::Client::new();
    let raw: RawManifest = client
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("No se pudo contactar con Mojang: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada del manifest de versiones: {e}"))?;

    Ok(VersionManifestSummary {
        latest_release: raw.latest.release,
        latest_snapshot: raw.latest.snapshot,
        versions: raw
            .versions
            .into_iter()
            .map(|v| VersionSummary { id: v.id, kind: v.kind, release_time: v.release_time })
            .collect(),
    })
}

async fn find_version_entry(version_id: &str) -> Result<RawVersionEntry, String> {
    let client = reqwest::Client::new();
    let raw: RawManifest = client
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("No se pudo contactar con Mojang: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Respuesta inesperada del manifest de versiones: {e}"))?;

    raw.versions
        .into_iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| format!("La versión {version_id} no existe en el manifest de Mojang."))
}

// ─── Descarga de archivos con verificación SHA1 ─────────────────────────────

fn sha1_matches(path: &Path, expected: &str) -> bool {
    let Ok(bytes) = std::fs::read(path) else { return false };
    let mut hasher = Sha1::new();
    hasher.update(&bytes);
    hex::encode(hasher.finalize()) == expected.to_lowercase()
}

pub async fn download_file(client: &reqwest::Client, url: &str, dest: &Path, expected_sha1: Option<&str>) -> Result<(), String> {
    if dest.exists() {
        if let Some(sha1) = expected_sha1 {
            if sha1_matches(dest, sha1) {
                return Ok(());
            }
        } else {
            return Ok(());
        }
    }

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Fallo al descargar {url}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Descarga fallida ({}): {url}", resp.status()));
    }

    let tmp_path = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Error de red descargando {url}: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    tokio::fs::rename(&tmp_path, dest).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub fn emit_progress(app: &AppHandle, stage: &str, current: u64, total: u64, detail: &str) {
    let _ = app.emit(
        "download-progress",
        serde_json::json!({ "stage": stage, "current": current, "total": total, "detail": detail }),
    );
}

// ─── Descarga completa de una instancia ─────────────────────────────────────

#[tauri::command]
pub async fn download_instance(app: AppHandle, instance_id: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let version_id = instance.version_id.clone();
    let client = reqwest::Client::new();

    emit_progress(&app, "manifest", 0, 1, &version_id);
    let entry = find_version_entry(&version_id).await?;

    let version_json_path = versions_dir().join(&version_id).join(format!("{version_id}.json"));
    download_file(&client, &entry.url, &version_json_path, None).await?;
    let detail: VersionDetail = serde_json::from_str(
        &std::fs::read_to_string(&version_json_path).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("No se pudo interpretar el JSON de la versión: {e}"))?;

    // ---- 1. Cliente (.jar) ----
    emit_progress(&app, "client", 0, 1, &version_id);
    let client_jar_path = versions_dir().join(&version_id).join(format!("{version_id}.jar"));
    download_file(&client, &detail.downloads.client.url, &client_jar_path, Some(&detail.downloads.client.sha1)).await?;

    // ---- 2. Librerías ----
    let mut classpath_entries: Vec<PathBuf> = vec![];
    let total_libs = detail.libraries.len() as u64;
    for (idx, lib) in detail.libraries.iter().enumerate() {
        emit_progress(&app, "libraries", idx as u64, total_libs, &lib.name);

        if !rules_allow(&lib.rules) {
            continue;
        }

        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                let rel_path = artifact.path.clone().unwrap_or_else(|| maven_path_from_name(&lib.name));
                let dest = libraries_dir().join(&rel_path);
                download_file(&client, &artifact.url, &dest, Some(&artifact.sha1)).await?;
                classpath_entries.push(dest);
            }

            // Natives "clásicos" (LWJGL2, pre-1.19): jar con clasificador por SO
            // que hay que descomprimir en una carpeta aparte.
            if let Some(natives_map) = &lib.natives {
                if let Some(classifier_key) = natives_map.get(current_os_name()) {
                    if let Some(classifiers) = &downloads.classifiers {
                        if let Some(native_artifact) = classifiers.get(classifier_key) {
                            let dest = libraries_dir().join(format!("{}-{}.jar", lib.name.replace([':', '.'], "_"), classifier_key));
                            download_file(&client, &native_artifact.url, &dest, Some(&native_artifact.sha1)).await?;
                            extract_natives(&dest, &natives_dir(&version_id), &lib.extract)?;
                        }
                    }
                }
            }
        }
    }

    // ---- 3. Assets ----
    emit_progress(&app, "assets", 0, 1, "índice de assets");
    let asset_index_path = assets_dir().join("indexes").join(format!("{}.json", detail.asset_index.id));
    download_file(&client, &detail.asset_index.url, &asset_index_path, Some(&detail.asset_index.sha1)).await?;

    #[derive(Deserialize)]
    struct AssetObject { hash: String }
    #[derive(Deserialize)]
    struct AssetIndexJson {
        objects: HashMap<String, AssetObject>,
        #[serde(default, rename = "virtual")]
        is_virtual: bool,
        #[serde(default)]
        map_to_resources: bool,
    }

    let asset_index_json: AssetIndexJson = serde_json::from_str(
        &std::fs::read_to_string(&asset_index_path).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("No se pudo interpretar el índice de assets: {e}"))?;

    let total_assets = asset_index_json.objects.len() as u64;
    let completed = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let is_virtual = asset_index_json.is_virtual;
    let map_to_resources = asset_index_json.map_to_resources;

    let results: Vec<Result<(), String>> = futures_util::stream::iter(asset_index_json.objects.into_iter())
        .map(|(name, obj)| {
            let client = client.clone();
            let completed = completed.clone();
            let app = app.clone();
            async move {
                let prefix = obj.hash[0..2].to_string();
                let url = format!("https://resources.download.minecraft.net/{prefix}/{}", obj.hash);
                let dest = assets_dir().join("objects").join(&prefix).join(&obj.hash);
                download_file(&client, &url, &dest, Some(&obj.hash)).await?;

                if is_virtual || map_to_resources {
                    let legacy_dest = assets_dir().join("virtual").join("legacy").join(&name);
                    if let Some(parent) = legacy_dest.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::copy(&dest, &legacy_dest);
                }

                let done = completed.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                emit_progress(&app, "assets", done, total_assets, &name);
                Ok::<(), String>(())
            }
        })
        // 24 descargas de assets a la vez: son muchos archivos pequeños,
        // así que el cuello de botella es la latencia, no el ancho de banda.
        .buffer_unordered(24)
        .collect()
        .await;

    for r in results {
        r?;
    }

    // ---- 4. Loader (Fabric, Forge, NeoForge) ----
    if instance.loader == "fabric" {
        crate::fabric::install(&app, &client, &instance_id, &version_id, instance.loader_version.as_deref()).await?;
    } else if instance.loader == "forge" || instance.loader == "neoforge" {
        let loader_version = instance
            .loader_version
            .clone()
            .ok_or_else(|| "Falta la versión de Forge/NeoForge elegida.".to_string())?;
        crate::forge::install(
            &app,
            &client,
            &instance_id,
            &instance.loader,
            &version_id,
            &loader_version,
            detail.java_version.as_ref().map(|jv| jv.major_version),
        )
        .await?;
    }

    emit_progress(&app, "done", 1, 1, "completo");
    instances::mark_installed(&instance_id)?;
    let _ = classpath_entries; // se reconstruye en el lanzado a partir del version_id ya instalado
    Ok(())
}

fn extract_natives(jar_path: &Path, dest_dir: &Path, extract_rule: &Option<ExtractRule>) -> Result<(), String> {
    let file = std::fs::File::open(jar_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let excludes = extract_rule.as_ref().map(|r| r.exclude.clone()).unwrap_or_default();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        if name.starts_with("META-INF/") || excludes.iter().any(|ex| name.starts_with(ex.as_str())) {
            continue;
        }
        if entry.is_dir() {
            continue;
        }

        let out_path = dest_dir.join(&name);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Lanzado del juego ───────────────────────────────────────────────────────

fn classpath_separator() -> &'static str {
    if cfg!(target_os = "windows") { ";" } else { ":" }
}

/// Extrae la versión mayor de Java de la salida de `java -version`
/// (que la imprime por stderr, no por stdout — cosas de Java).
///
/// Formatos que hay que soportar:
///   - Esquema viejo (Java 8 y anteriores): `"1.8.0_391"` → 8
///   - Esquema nuevo (Java 9+):            `"21.0.1"` o `"17"` → 21 / 17
fn parse_java_major(version_output: &str) -> Option<u32> {
    let start = version_output.find('"')?;
    let rest = &version_output[start + 1..];
    let end = rest.find('"')?;
    let version_str = &rest[..end];

    let mut parts = version_str.split(|c: char| c == '.' || c == '_' || c == '-' || c == '+');
    let first: u32 = parts.next()?.parse().ok()?;
    if first == 1 {
        parts.next()?.parse().ok()
    } else {
        Some(first)
    }
}

/// Ejecuta `<path> -version` y devuelve la versión mayor detectada, o
/// `None` si el binario no existe o no se pudo interpretar la salida.
fn probe_java_major(path: &str) -> Option<u32> {
    let output = run_hidden(std::process::Command::new(path).arg("-version")).ok()?;
    parse_java_major(&String::from_utf8_lossy(&output.stderr))
}

/// Busca un Java utilizable. Si `required_major` viene informado (lo trae
/// el `javaVersion` del version.json — ver `minecraft::vanilla::VersionDetail`),
/// exige que la versión encontrada lo cumpla o lo supere: un JDK más nuevo
/// puede correr class files más viejos, pero no al revés, y lanzar con un
/// Java demasiado viejo para la versión de Minecraft elegida termina en un
/// `UnsupportedClassVersionError` bastante críptico para quien no sepa leer
/// un stacktrace de Java. Mejor detectarlo antes y decir claramente qué
/// versión hace falta.
pub fn find_java(required_major: Option<u32>) -> Result<String, String> {
    let mut candidates: Vec<String> = vec![];
    // Un Java que hayamos descargado nosotros mismos (java_runtime.rs) va
    // primero: si existe, es justo el que pide esta versión, no hace falta
    // ni comprobarlo contra el PATH.
    if let Some(req) = required_major {
        if let Some(managed) = crate::java_runtime::managed_java_path(req) {
            candidates.push(managed.to_string_lossy().to_string());
        }
    }
    candidates.push("java".to_string());
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let bin = if cfg!(target_os = "windows") { "bin/java.exe" } else { "bin/java" };
        let candidate = PathBuf::from(home).join(bin);
        if candidate.exists() {
            candidates.push(candidate.to_string_lossy().to_string());
        }
    }

    let mut found: Vec<(String, Option<u32>)> = vec![];
    for path in &candidates {
        if let Some(major) = probe_java_major(path) {
            if required_major.map_or(true, |req| major >= req) {
                return Ok(path.clone());
            }
            found.push((path.clone(), Some(major)));
        }
    }

    // Java pre-1.17 no declara `javaVersion` — Java 8 es lo históricamente
    // recomendado para esas versiones, así que es el valor por defecto
    // razonable a ofrecer para instalar automáticamente en ese caso.
    let install_target = required_major.unwrap_or(8);

    // El prefijo "JAVA_MISSING:<major>::" es lo que el frontend busca para
    // ofrecer el botón "Instalar Java automáticamente" (ver
    // RunningInstancesContext.tsx) — todo lo que va después del "::" es el
    // mensaje legible que se muestra tal cual si algo falla en ese camino.
    if let Some(req) = required_major {
        if !found.is_empty() {
            let versions: Vec<String> = found
                .iter()
                .map(|(_, m)| m.map(|v| format!("Java {v}")).unwrap_or_else(|| "versión desconocida".to_string()))
                .collect();
            return Err(format!(
                "JAVA_MISSING:{install_target}::Esta versión de Minecraft necesita Java {req} o \
                 superior, pero en tu sistema solo se encontró {}.",
                versions.join(", ")
            ));
        }
    }

    Err(format!(
        "JAVA_MISSING:{install_target}::No se encontró ninguna instalación de Java en tu sistema."
    ))
}

/// Ejecuta un `Command` de comprobación rápida (p. ej. `java -version`) sin
/// que Windows le abra una ventana de consola de por medio (el mismo
/// problema que `CREATE_NO_WINDOW` soluciona al lanzar el juego en sí).
fn run_hidden(command: &mut std::process::Command) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.output()
}

fn to_dashed_uuid(raw: &str) -> String {
    let clean: String = raw.chars().filter(|c| *c != '-').collect();
    if clean.len() != 32 {
        return raw.to_string();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &clean[0..8], &clean[8..12], &clean[12..16], &clean[16..20], &clean[20..32]
    )
}

/// Genera un UUID "offline" a partir del nombre de usuario, con el mismo
/// algoritmo que usan los servidores de Minecraft en modo offline
/// (`UUID.nameUUIDFromBytes("OfflinePlayer:<username>")`, un UUID v3/MD5).
/// Sirve para poder probar la descarga y el lanzado del juego sin necesitar
/// todavía una cuenta de Microsoft real (por ejemplo, mientras se espera la
/// aprobación de Mojang para la API).
fn offline_uuid(username: &str) -> String {
    let digest = md5::compute(format!("OfflinePlayer:{username}"));
    let mut bytes = digest.0;
    bytes[6] = (bytes[6] & 0x0f) | 0x30; // versión 3 (name-based, MD5)
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
    let hex_str = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex_str[0..8], &hex_str[8..12], &hex_str[12..16], &hex_str[16..20], &hex_str[20..32]
    )
}

fn substitute(template: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = template.to_string();
    for (key, value) in vars {
        out = out.replace(&format!("${{{key}}}"), value);
    }
    out
}

#[tauri::command]
pub async fn launch_instance(app: AppHandle, instance_id: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    if !instance.installed {
        return Err("Esta instancia todavía no se ha descargado.".to_string());
    }

    let (username, mc_uuid, mc_access_token, user_type) = match auth::get_active_account() {
        Some(account) => {
            let fresh = auth::ensure_fresh_account(&account.id).await?;
            (fresh.username, fresh.mc_uuid, fresh.mc_access_token, "msa".to_string())
        }
        None => {
            let _ = app.emit(
                "game-log",
                "[nightverix] sin cuenta de Microsoft activa: lanzando en modo offline/demo \
                 (solo un jugador; no podrás unirte a servidores con modo online)."
                    .to_string(),
            );
            let username = "Jugador".to_string();
            let uuid = offline_uuid(&username);
            (username, uuid, "0".to_string(), "legacy".to_string())
        }
    };
    let version_id = &instance.version_id;

    let version_json_path = versions_dir().join(version_id).join(format!("{version_id}.json"));
    let detail: VersionDetail = serde_json::from_str(
        &std::fs::read_to_string(&version_json_path).map_err(|_| "Faltan archivos de la versión. Vuelve a descargar la instancia.".to_string())?,
    )
    .map_err(|e| format!("No se pudo interpretar el JSON de la versión: {e}"))?;

    let java_bin = find_java(detail.java_version.as_ref().map(|jv| jv.major_version))?;

    // Reconstruir el classpath a partir de las librerías ya descargadas.
    let mut classpath: Vec<String> = vec![];
    for lib in &detail.libraries {
        if !rules_allow(&lib.rules) {
            continue;
        }
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                let rel_path = artifact.path.clone().unwrap_or_else(|| maven_path_from_name(&lib.name));
                classpath.push(libraries_dir().join(rel_path).to_string_lossy().to_string());
            }
        }
    }

    // Si la instancia usa Fabric, sus librerías y su main class sustituyen a
    // las de Vanilla (que se queda como base para assets/argumentos de juego).
    let mut effective_main_class = detail.main_class.clone();
    let mut forge_detail: Option<crate::minecraft::loader_version::LoaderVersionJson> = None;

    if instance.loader == "fabric" {
        let fabric_cache = crate::fabric::load_cache(&instance_id)?;
        effective_main_class = fabric_cache.main_class;
        for rel_path in &fabric_cache.library_paths {
            classpath.push(libraries_dir().join(rel_path).to_string_lossy().to_string());
        }
    } else if instance.loader == "forge" || instance.loader == "neoforge" {
        // El JSON de Forge/NeoForge lo produjo su propio instalador oficial
        // (ver forge.rs). Tiene una forma parecida a la de Vanilla, pero NO
        // es lo mismo: normalmente declara "inheritsFrom" y por eso no
        // redeclara "downloads"/"assetIndex" (los hereda). Por eso usamos un
        // tipo propio (LoaderVersionJson) donde esos campos son de verdad
        // opcionales, en vez de forzar el VersionDetail estricto de Vanilla.
        let forge_cache = crate::forge::load_cache(&instance_id)?;
        let forge_json_path = versions_dir()
            .join(&forge_cache.effective_version_id)
            .join(format!("{}.json", forge_cache.effective_version_id));
        let fd: crate::minecraft::loader_version::LoaderVersionJson = serde_json::from_str(
            &std::fs::read_to_string(&forge_json_path).map_err(|_| {
                "Faltan archivos de Forge/NeoForge. Vuelve a descargar la instancia.".to_string()
            })?,
        )
        .map_err(|e| format!("No se pudo interpretar el version.json de Forge/NeoForge: {e}"))?;

        effective_main_class = fd.main_class.clone();
        for lib in &fd.libraries {
            if !rules_allow(&lib.rules) {
                continue;
            }
            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    let rel_path = artifact.path.clone().unwrap_or_else(|| maven_path_from_name(&lib.name));
                    classpath.push(libraries_dir().join(rel_path).to_string_lossy().to_string());
                }
            }
        }
        forge_detail = Some(fd);
    }

    let client_jar = versions_dir().join(version_id).join(format!("{version_id}.jar"));
    classpath.push(client_jar.to_string_lossy().to_string());
    let classpath_str = classpath.join(classpath_separator());

    let game_dir = instances::instance_game_dir(&instance_id);
    let natives_path = natives_dir(version_id);

    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("auth_player_name", username);
    vars.insert("version_name", detail.id.clone());
    vars.insert("game_directory", game_dir.to_string_lossy().to_string());
    vars.insert("assets_root", assets_dir().to_string_lossy().to_string());
    vars.insert("assets_index_name", detail.asset_index.id.clone());
    vars.insert("auth_uuid", to_dashed_uuid(&mc_uuid));
    vars.insert("auth_access_token", mc_access_token);
    vars.insert("auth_xuid", String::new());
    vars.insert("clientid", auth::MS_CLIENT_ID.to_string());
    vars.insert("user_type", user_type);
    vars.insert("version_type", detail.kind.clone());
    vars.insert("natives_directory", natives_path.to_string_lossy().to_string());
    vars.insert("launcher_name", "Nightverix Client".to_string());
    vars.insert("launcher_version", env!("CARGO_PKG_VERSION").to_string());
    vars.insert("classpath", classpath_str);
    // Estas tres las usan los version.json que genera el instalador de
    // Forge/NeoForge modernos en sus argumentos de JVM. Si faltan, el token
    // (p. ej. "${library_directory}") se cuela literal en la línea de
    // comandos de java, y FML/FancyModLoader lo interpreta como una ruta de
    // verdad, no la encuentra, y reporta "instalación corrupta" — que es
    // justo el síntoma que veíamos con NeoForge.
    vars.insert("library_directory", libraries_dir().to_string_lossy().to_string());
    vars.insert("classpath_separator", classpath_separator().to_string());
    // No usamos módulos de Java con nombre (JPMS) todavía, así que va vacío
    // — pero tiene que EXISTIR como variable para que el token se sustituya
    // por "" en vez de quedarse sin reemplazar.
    vars.insert("module_path", String::new());

    let mut jvm_args: Vec<String> = vec![
        format!("-Xmx{}M", DEFAULT_MAX_HEAP_MB),
        format!("-Djava.library.path={}", natives_path.to_string_lossy()),
    ];
    let mut game_args: Vec<String> = vec![];

    if let Some(arguments) = &detail.arguments {
        for arg in &arguments.jvm {
            collect_arg(arg, &vars, &mut jvm_args);
        }
        // Asegurar que el classpath siempre esté presente aunque la versión no lo liste.
        if !jvm_args.iter().any(|a| a == "-cp" || a == "-classpath") {
            jvm_args.push("-cp".to_string());
            jvm_args.push(vars.get("classpath").cloned().unwrap_or_default());
        }
        for arg in &arguments.game {
            collect_arg(arg, &vars, &mut game_args);
        }
    } else {
        jvm_args.push("-cp".to_string());
        jvm_args.push(vars.get("classpath").cloned().unwrap_or_default());
        if let Some(legacy) = &detail.minecraft_arguments {
            for token in legacy.split_whitespace() {
                game_args.push(substitute(token, &vars));
            }
        }
    }

    // Los argumentos propios de Forge/NeoForge van DESPUÉS de los de Vanilla
    // (igual que hace el launcher oficial al resolver "inheritsFrom").
    if let Some(fd) = &forge_detail {
        if let Some(arguments) = &fd.arguments {
            for arg in &arguments.jvm {
                collect_arg(arg, &vars, &mut jvm_args);
            }
            for arg in &arguments.game {
                collect_arg(arg, &vars, &mut game_args);
            }
        }
    }

    let mut command_args: Vec<String> = vec![];
    command_args.extend(jvm_args);
    command_args.push(effective_main_class);
    command_args.extend(game_args);

    let _ = app.emit(
        "game-log",
        serde_json::json!({ "instanceId": instance_id, "line": format!("[nightverix] lanzando: {java_bin} ...") }),
    );

    let mut command = TokioCommand::new(&java_bin);
    command
        .args(&command_args)
        .current_dir(&game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // En Windows, java.exe es una aplicación de consola: si no le decimos
    // explícitamente lo contrario, el sistema le abre su propia ventana de
    // terminal al lanzarlo como proceso hijo, aunque el launcher no la tenga.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("No se pudo lanzar Java: {e}"))?;

    if let Some(pid) = child.id() {
        running_registry().lock().unwrap().insert(
            instance_id.clone(),
            RunningInstance {
                instance_id: instance_id.clone(),
                version_id: version_id.clone(),
                pid,
                started_at: now_unix(),
            },
        );
        let _ = app.emit("instances-changed", ());
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let app_stdout = app.clone();
    let app_stderr = app.clone();
    let app_exit = app.clone();
    let id_stdout = instance_id.clone();
    let id_stderr = instance_id.clone();
    let id_exit = instance_id.clone();

    if let Some(stdout) = stdout {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stdout.emit("game-log", serde_json::json!({ "instanceId": id_stdout, "line": line }));
            }
        });
    }
    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stderr.emit("game-log", serde_json::json!({ "instanceId": id_stderr, "line": line }));
            }
        });
    }

    tokio::spawn(async move {
        let status = child.wait().await;
        let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
        running_registry().lock().unwrap().remove(&id_exit);
        let _ = app_exit.emit("instances-changed", ());
        let _ = app_exit.emit("game-exit", serde_json::json!({ "instanceId": id_exit, "code": code }));
    });

    Ok(())
}

// ─── Registro de instancias en ejecución (para la pantalla de Instancias) ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunningInstance {
    pub instance_id: String,
    pub version_id: String,
    pub pid: u32,
    pub started_at: i64,
}

static RUNNING: std::sync::OnceLock<std::sync::Mutex<HashMap<String, RunningInstance>>> = std::sync::OnceLock::new();

fn running_registry() -> &'static std::sync::Mutex<HashMap<String, RunningInstance>> {
    RUNNING.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_running_instances() -> Vec<RunningInstance> {
    running_registry().lock().unwrap().values().cloned().collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceStats {
    pub memory_mb: u64,
    pub cpu_percent: f32,
    pub gpu_percent: Option<f32>,
    pub gpu_memory_mb: Option<u64>,
}

/// Algunos sistemas resuelven `java` a través de un "shim" (típico de
/// gestores de versiones de Java) que a su vez lanza el proceso real como
/// hijo. Si midiéramos solo el PID que lanzamos, veríamos siempre ~0 de RAM/CPU
/// porque el shim en sí no hace nada. Para evitarlo, recorremos el árbol de
/// procesos descendientes del PID lanzado y nos quedamos con el que más
/// memoria esté usando — casi siempre es el JVM real.
fn find_dominant_pid(sys: &sysinfo::System, root: sysinfo::Pid) -> sysinfo::Pid {
    use std::collections::{HashSet, VecDeque};

    let mut visited: HashSet<sysinfo::Pid> = HashSet::new();
    let mut queue: VecDeque<sysinfo::Pid> = VecDeque::new();
    queue.push_back(root);
    visited.insert(root);

    let mut best = root;
    let mut best_mem = sys.process(root).map(|p| p.memory()).unwrap_or(0);

    while let Some(pid) = queue.pop_front() {
        for (candidate_pid, proc) in sys.processes() {
            if proc.parent() == Some(pid) && visited.insert(*candidate_pid) {
                queue.push_back(*candidate_pid);
                let mem = proc.memory();
                if mem > best_mem {
                    best_mem = mem;
                    best = *candidate_pid;
                }
            }
        }
    }
    best
}

/// GPU "best effort": solo funciona si hay una GPU NVIDIA con `nvidia-smi`
/// disponible en el PATH. Para AMD/Intel no hay una herramienta de línea de
/// comandos equivalente y universal, así que en esos casos devolvemos `None`
/// y el frontend lo muestra como "N/D" en vez de inventar un dato.
async fn query_gpu_stats() -> Option<(f32, u64)> {
    let mut command = tokio::process::Command::new("nvidia-smi");
    command.args(["--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"]);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command.output().await.ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let first_line = text.lines().next()?;
    let mut parts = first_line.split(',').map(|s| s.trim());
    let util: f32 = parts.next()?.parse().ok()?;
    let mem_mb: u64 = parts.next()?.parse().ok()?;
    Some((util, mem_mb))
}

/// Lee RAM y CPU reales del proceso de Java de una instancia en marcha (y GPU,
/// si hay una NVIDIA disponible). Hace dos lecturas separadas por ~300ms
/// porque sysinfo necesita ese intervalo entre refrescos para calcular un %
/// de CPU con sentido.
#[tauri::command]
pub async fn get_instance_stats(instance_id: String) -> Result<InstanceStats, String> {
    let pid = {
        let reg = running_registry().lock().unwrap();
        reg.get(&instance_id).map(|r| r.pid)
    };
    let Some(pid) = pid else {
        return Err("La instancia no está en ejecución.".to_string());
    };
    let sys_pid = sysinfo::Pid::from_u32(pid);

    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All);
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All);

    let target = find_dominant_pid(&sys, sys_pid);

    let core_count = sys.cpus().len().max(1) as f32;
    let (memory_mb, cpu_percent) = match sys.process(target) {
        // sysinfo da el % de CPU por núcleo (como `top`), así que puede pasar
        // de 100% en procesos multi-hilo. Lo normalizamos al total del
        // sistema, como el Administrador de Tareas de Windows.
        Some(proc) => (proc.memory() / 1024 / 1024, proc.cpu_usage() / core_count),
        None => return Err("El proceso ya no existe (¿se cerró el juego?).".to_string()),
    };

    let (gpu_percent, gpu_memory_mb) = match query_gpu_stats().await {
        Some((util, mem)) => (Some(util), Some(mem)),
        None => (None, None),
    };

    Ok(InstanceStats { memory_mb, cpu_percent, gpu_percent, gpu_memory_mb })
}

fn collect_arg(arg: &ArgValue, vars: &HashMap<&str, String>, out: &mut Vec<String>) {
    match arg {
        ArgValue::Plain(s) => out.push(substitute(s, vars)),
        ArgValue::Conditional { rules, value } => {
            if rules_allow(&Some(rules.clone())) {
                match value {
                    ArgValueInner::Single(s) => out.push(substitute(s, vars)),
                    ArgValueInner::Multiple(items) => {
                        for item in items {
                            out.push(substitute(item, vars));
                        }
                    }
                }
            }
        }
    }
}
