//! Tipos de datos de Minecraft, separados por formato real en vez de forzar
//! un único struct para todo:
//!
//!   - `vanilla`         → el `version.json` oficial de Mojang (estricto: si
//!                          falta `downloads` o `assetIndex`, es un error de
//!                          verdad, no algo que ocultar con `Option`).
//!   - `loader_version`  → el `version.json` que deja el instalador de un
//!                          loader (Forge/NeoForge) dentro de
//!                          `versions/<id>/<id>.json`. Con la misma forma
//!                          general, pero SIN los campos que hereda de
//!                          Vanilla vía `inheritsFrom` — ahí sí son opcionales
//!                          de verdad, porque legítimamente pueden no estar.
//!   - `install_profile` → el `install_profile.json` de dentro del propio
//!                          `.jar` del instalador. No es un version.json en
//!                          absoluto — es el formato interno del instalador
//!                          (processors, data, libraries a usar durante la
//!                          instalación).

pub mod install_profile;
pub mod loader_version;
pub mod parser;
pub mod vanilla;
