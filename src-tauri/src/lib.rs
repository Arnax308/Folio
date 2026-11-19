use std::path::{Path, PathBuf};
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, WebviewWindow};
#[cfg(desktop)]
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

/// Files Folio has been asked to open (Explorer double-click / "Open with") and not yet shown.
struct Pending(Mutex<Vec<PathBuf>>);

const DOC_EXTS: [&str; 6] = ["pdf", "md", "markdown", "mdown", "mkd", "txt"];
const TEXT_EXTS: [&str; 5] = ["md", "markdown", "mdown", "mkd", "txt"];

fn has_ext(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| allowed.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Document paths from a command line (the first argument is the program itself).
fn files_from_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&Path>) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            match cwd {
                Some(dir) if p.is_relative() => dir.join(p),
                _ => p,
            }
        })
        .filter(|p| p.is_file() && has_ext(p, &DOC_EXTS))
        .collect()
}

/// Android: where MainActivity copies documents from "Open with" / "Share" (cache/folio-incoming,
/// one folder per document). Several spellings of the app's cache folder, as Android has aliases.
#[cfg(mobile)]
fn incoming_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(cache) = app.path().app_cache_dir() {
        dirs.push(cache.join("folio-incoming"));
    }
    let id = &app.config().identifier;
    dirs.push(PathBuf::from(format!("/data/user/0/{id}/cache/folio-incoming")));
    dirs.push(PathBuf::from(format!("/data/data/{id}/cache/folio-incoming")));
    dirs
}

#[tauri::command]
fn take_pending(app: AppHandle, state: tauri::State<Pending>) -> Vec<String> {
    #[cfg_attr(desktop, allow(unused_mut))]
    let mut out: Vec<String> = match state.0.lock() {
        Ok(mut files) => files
            .drain(..)
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        Err(_) => Vec::new(),
    };
    #[cfg(mobile)]
    {
        let mut seen = std::collections::HashSet::new();
        for dir in incoming_dirs(&app) {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                // only finished copies: a folder holding the document ("….part" files are still arriving)
                let Ok(inner) = std::fs::read_dir(entry.path()) else { continue };
                for file in inner.flatten() {
                    let p = file.path();
                    let key = std::fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
                    if p.is_file() && has_ext(&p, &DOC_EXTS) && seen.insert(key) {
                        out.push(p.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }
    #[cfg(desktop)]
    let _ = &app;
    out
}

/// Reads a document Folio was asked to open. Only PDF, Markdown and text files.
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    let path = PathBuf::from(path);
    if !has_ext(&path, &DOC_EXTS) {
        return Err("Folio only opens PDF, Markdown and text files".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    // Android: the copy made for "Open with" has done its job once it's in the library
    if path.to_string_lossy().contains("/folio-incoming/") {
        let _ = std::fs::remove_file(&path);
        if let Some(parent) = path.parent() {
            let _ = std::fs::remove_dir(parent);
        }
    }
    Ok(Response::new(bytes))
}

/// Saves a Markdown document back to its file on disk. Only Markdown and text files.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !has_ext(&path, &TEXT_EXTS) {
        return Err("Folio only writes Markdown and text files".into());
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Shows the native "Save as" dialog and writes the request body to the chosen file.
/// The suggested name and file type arrive percent-encoded in headers; the body is the raw bytes.
#[tauri::command(async)]
fn save_as(app: AppHandle, window: WebviewWindow, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file contents as raw bytes".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
            .unwrap_or_default()
    };
    let name = header("x-name");
    let ext = header("x-ext");
    let label = header("x-label");

    let mut dialog = app.dialog().file();
    #[cfg(desktop)]
    {
        dialog = dialog.set_parent(&window);
    }
    #[cfg(mobile)]
    let _ = &window;
    if !name.is_empty() {
        dialog = dialog.set_file_name(name.clone());
    }
    if !ext.is_empty() {
        dialog = dialog.add_filter(if label.is_empty() { "File".to_string() } else { label }, &[ext.as_str()]);
    }
    let Some(target) = dialog.blocking_save_file() else {
        return Ok(None); // cancelled
    };

    #[cfg(desktop)]
    {
        let path = target.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
    #[cfg(mobile)]
    {
        // Android hands back a content:// location; the fs plugin opens it through Android's APIs.
        use std::io::Write;
        use tauri_plugin_fs::{FsExt, OpenOptions};
        let mut opts = OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        let mut file = app.fs().open(target, opts).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        // the location is an opaque URI, so report the name the user saw
        Ok(Some(if name.is_empty() { "file".into() } else { name }))
    }
}

/// Shrinks the window to fit the screen it opens on (minus the taskbar), centres it, then shows it.
/// The configured 1360×880 is too tall for a 1080p screen at 125% scaling, for example.
#[cfg(desktop)]
fn fit_to_screen(window: &WebviewWindow) {
    let fit = || -> tauri::Result<()> {
        let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
            return Ok(());
        };
        let area = monitor.work_area();
        let size = window.outer_size()?;
        let max_w = (area.size.width as f64 * 0.96) as u32;
        let max_h = (area.size.height as f64 * 0.94) as u32;
        let w = size.width.min(max_w);
        let h = size.height.min(max_h);
        if w != size.width || h != size.height {
            window.set_size(tauri::PhysicalSize::new(w, h))?;
        }
        let x = area.position.x + (area.size.width as i32 - w as i32) / 2;
        let y = area.position.y + (area.size.height as i32 - h as i32) / 2;
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
        Ok(())
    };
    let _ = fit();
    let _ = window.show(); // always show, even if measuring the screen failed
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Desktop: must be registered first — a second launch hands its file to the running window and exits.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let files = files_from_args(argv, Some(Path::new(&cwd)));
        if let Some(pending) = app.try_state::<Pending>() {
            if let Ok(mut list) = pending.0.lock() {
                list.extend(files);
            }
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = app.emit("folio-open", ());
    }));

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_fs::init());

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Pending(Mutex::new(files_from_args(std::env::args(), None))))
        .setup(|_app| {
            if let Some(window) = _app.get_webview_window("main") {
                #[cfg(desktop)]
                fit_to_screen(&window);
                #[cfg(mobile)]
                let _ = window.show(); // the shared config starts the window hidden
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![take_pending, read_file, write_text_file, save_as])
        .run(tauri::generate_context!())
        .expect("error while running Folio");
}
