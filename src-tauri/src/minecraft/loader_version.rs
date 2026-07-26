//! El `version.json` que deja el instalador de un loader (Forge, NeoForge)
//! en `versions/<id>/<id>.json`, tras correr en modo headless.
//!
//! Tiene la misma forma general que el de Vanilla (`vanilla::VersionDetail`),
//! pero **no es lo mismo**: normalmente declara `"inheritsFrom": "<mc-version>"`
//! y por eso NO redeclara los campos que hereda de esa versión base —
//! `downloads` y `assetIndex` sencillamente no están casi nunca. Aquí son
//! `Option` porque de verdad pueden no existir, no para tapar un error de
//! deserialización.

use serde::Deserialize;

use super::vanilla::{ArgumentsSection, AssetIndexRef, DownloadsSection, LibraryEntry};

#[derive(Deserialize, Clone)]
pub struct LoaderVersionJson {
    pub id: String,
    #[serde(rename = "inheritsFrom", default)]
    pub inherits_from: Option<String>,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    #[serde(default)]
    pub libraries: Vec<LibraryEntry>,
    #[serde(default)]
    pub arguments: Option<ArgumentsSection>,
    /// Casi nunca presente (se hereda de la versión base), pero algunos
    /// loaders antiguos sí lo redeclaran — por eso lo leemos si está.
    #[serde(default)]
    pub downloads: Option<DownloadsSection>,
    #[serde(default, rename = "assetIndex")]
    pub asset_index: Option<AssetIndexRef>,
}
