mod auth;
mod commands;
mod fabric;
mod forge;
mod instances;
mod java_runtime;
mod launcher;
mod minecraft;
mod mods;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_system_info,
            commands::get_app_version,
            auth::start_device_login,
            auth::poll_device_login,
            auth::list_accounts,
            auth::get_active_account,
            auth::set_active_account,
            auth::remove_account,
            auth::logout_account,
            instances::list_instances,
            instances::create_instance,
            instances::delete_instance,
            instances::open_instance_folder,
            launcher::get_version_manifest,
            launcher::download_instance,
            launcher::launch_instance,
            launcher::list_running_instances,
            launcher::get_instance_stats,
            mods::list_installed_mods,
            mods::install_mod,
            mods::remove_mod,
            fabric::get_fabric_loader_versions,
            forge::get_forge_versions,
            java_runtime::install_java,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar la aplicación de Tauri");
}
