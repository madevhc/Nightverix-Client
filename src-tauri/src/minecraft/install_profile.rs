//! El `install_profile.json` de dentro del `.jar` del instalador de Forge o
//! NeoForge. **No es un version.json** — es el formato interno propio del
//! instalador: describe qué librerías necesita para instalarse a sí mismo, y
//! los "processors" que ejecuta para parchear el cliente de Vanilla.
//!
//! De momento no ejecutamos los processors nosotros mismos (delegamos esa
//! parte en el instalador oficial, ver `forge.rs`), pero tipamos el formato
//! completo igualmente: sirve para detectar con confianza que un archivo es
//! de verdad un install profile, y deja el terreno preparado si en el futuro
//! decidimos ejecutar los processors de forma nativa.

use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, Clone)]
pub struct InstallProfile {
    /// Id de la versión final que va a generar, p. ej. "1.20.1-forge-47.2.0".
    pub version: String,
    /// Ruta dentro del propio .jar del instalador al version.json que hay
    /// que copiar a `versions/<version>/<version>.json`.
    #[serde(default)]
    pub json: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub minecraft: Option<String>,
    #[serde(default)]
    pub data: HashMap<String, DataEntry>,
    #[serde(default)]
    pub processors: Vec<Processor>,
    /// No las tipamos a fondo — el instalador oficial ya se encarga de
    /// descargarlas e interpretarlas, nosotros solo necesitamos saber que
    /// existen para confirmar que el archivo es un install profile válido.
    #[serde(default)]
    pub libraries: Vec<serde_json::Value>,
    #[serde(default)]
    pub spec: Option<u32>,
    #[serde(rename = "mirrorList", default)]
    pub mirror_list: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct DataEntry {
    pub client: String,
    #[serde(default)]
    pub server: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct Processor {
    pub jar: String,
    #[serde(default)]
    pub classpath: Vec<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub sides: Vec<String>,
}

/// Comprueba, sin ambigüedad, si un JSON es un install_profile (y no un
/// version.json corriente) mirando los campos que solo tiene el primero.
pub fn looks_like_install_profile(value: &serde_json::Value) -> bool {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return false,
    };
    obj.contains_key("processors")
        || obj.contains_key("data")
        || obj.contains_key("spec")
        || obj.contains_key("mirrorList")
}
