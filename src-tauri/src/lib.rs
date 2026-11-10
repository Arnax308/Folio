use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Response;

/// File passed on the command line (e.g. "Open with Folio" / double-click in Explorer).
struct StartupFile(Mutex<Option<PathBuf>>);

#[tauri::command]
fn startup_file_name(state: tauri::State<StartupFile>) -> Option<String> {
    let guard = state.0.lock().ok()?;
    guard
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
}

#[tauri::command]
fn startup_file_bytes(state: tauri::State<StartupFile>) -> Result<Response, String> {
    let path = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "no startup file".to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .find(|p| p.is_file());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(StartupFile(Mutex::new(startup)))
        .invoke_handler(tauri::generate_handler![startup_file_name, startup_file_bytes])
        .run(tauri::generate_context!())
        .expect("error while running Folio");
}
