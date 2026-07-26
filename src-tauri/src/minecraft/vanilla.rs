//! El `version.json` oficial de Mojang. Estos campos SIEMPRE están presentes
//! en un version.json real de Vanilla — si faltan, es una señal de que el
//! archivo no es lo que esperábamos, no algo que deba silenciarse con
//! `Option`. Por eso este struct es estricto a propósito.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize, Clone)]
pub struct VersionDetail {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub downloads: DownloadsSection,
    #[serde(rename = "assetIndex")]
    pub asset_index: AssetIndexRef,
    #[serde(default)]
    pub libraries: Vec<LibraryEntry>,
    pub arguments: Option<ArgumentsSection>,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments: Option<String>,
    /// Ausente en versiones viejas (pre-1.17, cuando Java 8 bastaba para
    /// todo). Cuando está presente, es la versión mínima de Java que Mojang
    /// dice que hace falta para esta versión del juego — lanzar con algo
    /// más viejo termina en `UnsupportedClassVersionError`.
    #[serde(rename = "javaVersion")]
    pub java_version: Option<JavaVersionRef>,
}

#[derive(Deserialize, Clone)]
pub struct JavaVersionRef {
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}

#[derive(Deserialize, Clone)]
pub struct DownloadsSection {
    pub client: Artifact,
}

#[derive(Deserialize, Clone)]
pub struct AssetIndexRef {
    pub id: String,
    pub url: String,
    pub sha1: String,
}

#[derive(Deserialize, Clone)]
pub struct Artifact {
    #[serde(default)]
    pub path: Option<String>,
    pub url: String,
    pub sha1: String,
}

#[derive(Deserialize, Clone)]
pub struct LibraryEntry {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<HashMap<String, String>>,
    pub extract: Option<ExtractRule>,
}

#[derive(Deserialize, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Deserialize, Clone)]
pub struct ExtractRule {
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Deserialize, Clone)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
    pub features: Option<serde_json::Value>,
}

#[derive(Deserialize, Clone)]
pub struct OsRule {
    pub name: Option<String>,
    pub arch: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct ArgumentsSection {
    #[serde(default)]
    pub game: Vec<ArgValue>,
    #[serde(default)]
    pub jvm: Vec<ArgValue>,
}

#[derive(Deserialize, Clone)]
#[serde(untagged)]
pub enum ArgValue {
    Plain(String),
    Conditional {
        #[serde(default)]
        rules: Vec<Rule>,
        value: ArgValueInner,
    },
}

#[derive(Deserialize, Clone)]
#[serde(untagged)]
pub enum ArgValueInner {
    Single(String),
    Multiple(Vec<String>),
}

pub fn current_os_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "osx",
        _ => "linux",
    }
}

fn rule_condition_matches(rule: &Rule) -> bool {
    let os_ok = match &rule.os {
        None => true,
        Some(os) => {
            let name_ok = os.name.as_deref().map_or(true, |n| n == current_os_name());
            let arch_ok = os.arch.as_deref().map_or(true, |a| a == std::env::consts::ARCH);
            name_ok && arch_ok
        }
    };
    // No soportamos ninguna "feature" especial (demo, resolución custom, quick play...)
    // todavía, así que cualquier regla que dependa de una feature no se activa.
    let features_ok = rule.features.is_none();
    os_ok && features_ok
}

/// Evalúa si una regla `rules` (de una librería o un argumento) se cumple
/// para el sistema actual, siguiendo el mismo algoritmo que usa el launcher
/// oficial: por defecto no permitido si hay reglas, y la última que
/// coincide decide.
pub fn rules_allow(rules: &Option<Vec<Rule>>) -> bool {
    match rules {
        None => true,
        Some(rs) => {
            let mut allowed = false;
            for r in rs {
                if rule_condition_matches(r) {
                    allowed = r.action == "allow";
                }
            }
            allowed
        }
    }
}

/// "group:artifact:version[:classifier]" -> "group/con/barras/artifact/version/artifact-version[-classifier].jar"
pub fn maven_path_from_name(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return name.replace(':', "_");
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    match parts.get(3) {
        Some(classifier) => format!("{group}/{artifact}/{version}/{artifact}-{version}-{classifier}.jar"),
        None => format!("{group}/{artifact}/{version}/{artifact}-{version}.jar"),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub id: String,
    pub kind: String,
    pub release_time: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionManifestSummary {
    pub latest_release: String,
    pub latest_snapshot: String,
    pub versions: Vec<VersionSummary>,
}
