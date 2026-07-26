//! Detecta automáticamente si un JSON es un `version.json` de Vanilla o un
//! `install_profile.json` de un instalador, mirando qué campos tiene —sin
//! asumir de antemano cuál de los dos es.

use super::install_profile::{looks_like_install_profile, InstallProfile};
use super::vanilla::VersionDetail;

pub enum MinecraftMetadata {
    Vanilla(VersionDetail),
    InstallProfile(InstallProfile),
}

pub fn parse_minecraft_json(raw: &str) -> Result<MinecraftMetadata, String> {
    let value: serde_json::Value = serde_json::from_str(raw).map_err(|e| format!("JSON inválido: {e}"))?;

    if looks_like_install_profile(&value) {
        let profile: InstallProfile = serde_json::from_value(value)
            .map_err(|e| format!("El archivo parece un install_profile.json pero no se pudo interpretar: {e}"))?;
        return Ok(MinecraftMetadata::InstallProfile(profile));
    }

    let looks_vanilla = value.as_object().is_some_and(|o| {
        o.contains_key("downloads")
            || o.contains_key("assetIndex")
            || o.contains_key("logging")
            || o.contains_key("javaVersion")
    });

    if looks_vanilla {
        let detail: VersionDetail = serde_json::from_value(value)
            .map_err(|e| format!("El archivo parece un version.json de Vanilla pero no se pudo interpretar: {e}"))?;
        return Ok(MinecraftMetadata::Vanilla(detail));
    }

    Err("El archivo no tiene la forma de un version.json de Vanilla ni de un install_profile.json.".to_string())
}
