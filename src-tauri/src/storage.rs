use std::fs;
use std::path::PathBuf;

/// Carpeta de datos de la aplicación (una por SO), donde guardamos
/// cuentas, instancias y todo lo que se descargue del juego.
///
/// Linux:   ~/.local/share/nightverix-client
/// Windows: %APPDATA%\nightverix-client
/// macOS:   ~/Library/Application Support/nightverix-client
pub fn app_data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("nightverix-client");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn instances_dir() -> PathBuf {
    let dir = app_data_dir().join("instances");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn cache_dir() -> PathBuf {
    let dir = app_data_dir().join("cache");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Option<T> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn write_json<T: serde::Serialize>(path: &PathBuf, value: &T) -> std::io::Result<()> {
    let content = serde_json::to_string_pretty(value)?;
    fs::write(path, content)
}
