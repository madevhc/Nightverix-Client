// Oculta la ventana de consola de Windows en builds de producción (release).
// En desarrollo (`cargo tauri dev` / debug) se deja, porque ahí sirve para
// ver los logs y errores de la app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nightverix_client_lib::run();
}
