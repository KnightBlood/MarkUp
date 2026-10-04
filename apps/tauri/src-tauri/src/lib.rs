use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileResult {
    path: String,
    content: String,
    encoding: String,
    crlf: bool,
    bom: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    path: String,
    kind: String,
    size: u64,
    mtime: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEvent {
    kind: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathInfo {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenDialogOptions {
    multiple: Option<bool>,
    directory: Option<bool>,
    default_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDialogOptions {
    default_path: Option<String>,
    default_ext: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    theme: String,
    font_size: u32,
    line_width: u32,
    recent_documents: Vec<String>,
    #[serde(default)]
    auto_save: Option<bool>,
    #[serde(default)]
    auto_save_delay_ms: Option<u32>,
    #[serde(default)]
    typewriter: Option<bool>,
    #[serde(default)]
    custom_theme: Option<serde_json::Value>,
    #[serde(default)]
    line_numbers: Option<bool>,
    #[serde(default)]
    show_stats: Option<bool>,
    #[serde(default)]
    focus_mode: Option<bool>,
    #[serde(default)]
    image_paste: Option<bool>,
    #[serde(default)]
    spellcheck: Option<bool>,
    #[serde(default)]
    disabled_plugins: Option<Vec<String>>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            font_size: 16,
            line_width: 780,
            recent_documents: Vec::new(),
            auto_save: None,
            auto_save_delay_ms: None,
            typewriter: None,
            custom_theme: None,
            line_numbers: None,
            show_stats: None,
            focus_mode: None,
            image_paste: None,
            spellcheck: None,
            disabled_plugins: None,
        }
    }
}

#[tauri::command]
async fn read_file(path: String) -> Result<FileResult, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let body = if bom { &bytes[3..] } else { &bytes[..] };
    let content = String::from_utf8_lossy(body).into_owned();
    Ok(FileResult {
        path,
        content: content.clone(),
        encoding: "utf8".into(),
        crlf: content.contains("\r\n"),
        bom,
    })
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

fn embed_mime_for_path(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "mp4" | "m4v" | "f4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" | "ogg" => "video/ogg",
        "mov" | "qt" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" | "divx" | "xvid" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "asf" => "video/x-ms-asf",
        "flv" => "video/x-flv",
        "ts" | "mts" | "m2ts" => "video/mp2t",
        "3gp" => "video/3gpp",
        "3g2" => "video/3gpp2",
        "rm" => "application/vnd.rn-realmedia",
        "rmvb" => "application/vnd.rn-realmedia-vbr",
        _ => "application/octet-stream",
    }
}

/// Binary-safe file read for embeds (3D model / video): returns a full
/// `data:` URL. Companion to read_file, which is text-only.
#[tauri::command]
async fn read_base64(path: String) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", embed_mime_for_path(&path), encoded))
}

#[tauri::command]
async fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = if entry
            .file_type()
            .map(|t| t.is_dir())
            .unwrap_or(false)
        {
            "dir".to_string()
        } else {
            "file".to_string()
        };
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            kind,
            size: meta.len(),
            mtime,
        });
    }
    Ok(out)
}

#[tauri::command]
async fn fs_watch(app: AppHandle, path: String) -> Result<(), String> {
    let handle = app.clone();
    thread::spawn(move || {
        let emit_handle = handle.clone();
        let inner = move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                for event_path in event.paths {
                    let payload = FsEvent {
                        kind: "change".into(),
                        path: event_path.to_string_lossy().into_owned(),
                    };
                    let _ = emit_handle.emit(
                        "host-event",
                        serde_json::json!({ "event": "fs-changed", "payload": payload }),
                    );
                }
            }
        };
        let mut watcher = match notify::recommended_watcher(inner) {
            Ok(w) => w,
            Err(err) => {
                let payload = FsEvent { kind: "error".into(), path: err.to_string() };
                let _ = handle.emit(
                    "host-event",
                    serde_json::json!({ "event": "fs-changed", "payload": payload }),
                );
                return;
            }
        };
        let _ = watcher.watch(Path::new(&path), RecursiveMode::Recursive);
        loop {
            thread::park()
        }
    });
    Ok(())
}

#[tauri::command]
async fn open_dialog(options: OpenDialogOptions) -> Result<Vec<PathInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown"]);
        let picked: Vec<PathBuf> = if options.directory.unwrap_or(false) {
            dialog.pick_folder().map(|p| vec![p]).unwrap_or_default()
        } else if options.multiple.unwrap_or(false) {
            dialog.pick_files().unwrap_or_default()
        } else {
            dialog.pick_file().map(|p| vec![p]).unwrap_or_default()
        };
        Ok::<Vec<PathInfo>, String>(
            picked
                .into_iter()
                .map(|p| PathInfo { path: p.to_string_lossy().into_owned() })
                .collect(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_dialog(_options: SaveDialogOptions) -> Result<Option<PathInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown"]).save_file();
        Ok::<Option<PathInfo>, String>(
            file.map(|p| PathInfo { path: p.to_string_lossy().into_owned() }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("cmd");
        c.arg("/c").arg("start").arg("").arg(&url);
        c
    } else if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    cmd.spawn()
        .map_err(|e| e.to_string())?
        .wait()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&title);
    }
    Ok(())
}

#[tauri::command]
async fn window_minimize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
    Ok(())
}

#[tauri::command]
async fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
    Ok(())
}

#[tauri::command]
async fn window_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
    Ok(())
}

/// The native menu bar is hidden (the in-app menu bar is the single menu), so
/// `帮助 → 开发者工具` reaches devtools through this command instead.
#[tauri::command]
async fn open_devtools(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
    Ok(())
}

/// Focus main window (if needed) and emit a host-event on the shared channel.
fn emit_host_event(app: &AppHandle, event: &str, payload: serde_json::Value) {
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_focused().unwrap_or(false) {
            let _ = window.set_focus();
        }
        let _ = window.emit(
            "host-event",
            serde_json::json!({ "event": event, "payload": payload }),
        );
    }
}

/// Extensions the app associates with (mirrors `bundle.fileAssociations` in
/// `tauri.conf.json` and the installers of the other shells).
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];

struct FileOpenState {
    /// The webview finished loading; `file-open` listeners exist only after the
    /// frontend's `boot()`, so earlier paths wait here.
    ready: bool,
    pending: Vec<String>,
}

static FILE_OPEN: std::sync::Mutex<FileOpenState> = std::sync::Mutex::new(FileOpenState {
    ready: false,
    pending: Vec::new(),
});

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
        .unwrap_or(false)
}

/// Hand an OS-initiated open to the app, buffering until the page is up.
fn deliver_file_open(app: &AppHandle, path: String) {
    if !is_markdown_path(Path::new(&path)) {
        return;
    }
    {
        let mut state = FILE_OPEN.lock().unwrap();
        if !state.ready {
            if !state.pending.iter().any(|queued| queued == &path) {
                state.pending.push(path);
            }
            return;
        }
    }
    emit_host_event(app, "file-open", serde_json::Value::String(path));
}

/// `Builder::on_page_load` hook: hands over everything buffered so far.
fn flush_file_open(app: &AppHandle) {
    let pending = {
        let mut state = FILE_OPEN.lock().unwrap();
        state.ready = true;
        std::mem::take(&mut state.pending)
    };
    for path in pending {
        emit_host_event(app, "file-open", serde_json::Value::String(path));
    }
}

/// Windows/Linux pass the associated file as a plain argument.
fn deliver_argv(app: &AppHandle, argv: impl IntoIterator<Item = String>) {
    for arg in argv {
        if arg.starts_with('-') {
            continue;
        }
        if Path::new(&arg).is_file() {
            deliver_file_open(app, arg);
        }
    }
}

/// Single-source application menu — parsed from menu.json (synced from
/// packages/host-api/src/menu.json by scripts/sync-menu.mjs).
#[derive(Deserialize)]
#[serde(tag = "kind")]
enum TemplateItem {
    #[serde(rename = "command")]
    Command { id: String, label: String },
    #[serde(rename = "separator")]
    Separator,
    #[serde(rename = "checkbox")]
    Checkbox {
        id: String,
        label: String,
        on: String,
        off: String,
    },
    #[serde(rename = "action")]
    Action {
        id: String,
        label: String,
        accelerator: Option<String>,
    },
}

#[derive(Deserialize)]
struct TemplateSection {
    label: String,
    items: Vec<TemplateItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalShortcutDef {
    command_id: String,
    accelerator: String,
    #[allow(dead_code)]
    wails_accelerator: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostMenuDef {
    menu: Vec<TemplateSection>,
    global_shortcuts: Vec<GlobalShortcutDef>,
}

fn load_menu() -> HostMenuDef {
    serde_json::from_str(include_str!("menu.json")).expect("parse menu.json")
}

/// Register OS-level shortcuts (fire when unfocused). Payload = command id.
#[cfg(desktop)]
fn register_global_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    app.handle()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

    let menu = load_menu();
    let gs = app.global_shortcut();
    for shortcut in &menu.global_shortcuts {
        let command_id = shortcut.command_id.clone();
        let accel = shortcut.accelerator.clone();
        if let Err(err) = gs.on_shortcut(accel.as_str(), move |handle, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                emit_host_event(
                    handle,
                    "global-shortcut",
                    serde_json::Value::String(command_id.clone()),
                );
            }
        }) {
            eprintln!("[markup] global shortcut failed: {accel}: {err}");
        }
    }
    Ok(())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("config.json"))
}

#[tauri::command]
async fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(_) => Ok(AppConfig::default()),
    }
}

/// Resolve a well-known app directory. 'plugins' creates `~/.markup/plugins`
/// on demand; 'pluginsLocal' resolves `plugins/` next to the executable and is
/// never created (portable installs may not have one).
#[tauri::command]
async fn get_path(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if name == "pluginsLocal" {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let parent = exe.parent().ok_or_else(|| "exe has no parent dir".to_string())?;
        return Ok(Some(parent.join("plugins").to_string_lossy().into_owned()));
    }
    let dir = match name.as_str() {
        "plugins" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            home.join(".markup").join("plugins")
        }
        "userData" => app.path().app_config_dir().map_err(|e| e.to_string())?,
        _ => return Ok(None),
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(Some(dir.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn set_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin (per its docs): a second launch — e.g.
        // double-clicking another `.md` — hands its argv to the running
        // instance instead of starting a second editor.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            deliver_argv(app, argv.into_iter().skip(1));
        }))
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            read_base64,
            read_dir,
            fs_watch,
            open_dialog,
            save_dialog,
            open_external,
            set_title,
            window_minimize,
            window_toggle_maximize,
            window_close,
            open_devtools,
            get_config,
            set_config,
            get_path
        ])
        .setup(|app| {
            #[cfg(desktop)]
            register_global_shortcuts(app)?;

            // Cold start via file association: Windows/Linux pass the path as
            // an argument.
            deliver_argv(app.handle(), std::env::args().skip(1));

            use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

            // Application menu built from menu.json (single source shared with Electron/Wails).
            let menu_def = load_menu();
            let mut auto_save_id = String::new();
            let mut auto_save_on = String::new();
            let mut auto_save_off = String::new();
            let mut auto_save_handle: Option<CheckMenuItem<tauri::Wry>> = None;

            let root_menu = Menu::new(app)?;
            for section in &menu_def.menu {
                let submenu = Submenu::new(app, section.label.as_str(), true)?;
                for item in &section.items {
                    match item {
                        TemplateItem::Command { id, label } => {
                            let mi = MenuItem::with_id(app, id, label, true, None::<&str>)?;
                            submenu.append(&mi)?;
                        }
                        TemplateItem::Separator => {
                            submenu.append(&PredefinedMenuItem::separator(app)?)?;
                        }
                        TemplateItem::Checkbox {
                            id,
                            label,
                            on,
                            off,
                        } => {
                            let cb =
                                CheckMenuItem::with_id(app, id, label, true, false, None::<&str>)?;
                            auto_save_id = id.clone();
                            auto_save_on = on.clone();
                            auto_save_off = off.clone();
                            auto_save_handle = Some(cb.clone());
                            submenu.append(&cb)?;
                        }
                        TemplateItem::Action {
                            id,
                            label,
                            accelerator,
                        } => {
                            // Menu accelerators use Electron-style CmdOrCtrl; Tauri parses CommandOrControl.
                            let accel = accelerator
                                .as_ref()
                                .map(|a| a.replace("CmdOrCtrl", "CommandOrControl"));
                            match id.as_str() {
                                "quit" => {
                                    submenu.append(&PredefinedMenuItem::quit(
                                        app,
                                        Some(label.as_str()),
                                    )?)?;
                                }
                                "reload" => {
                                    // Tauri has no predefined reload — reuse the renderer's app.reload command.
                                    let mi = MenuItem::with_id(
                                        app,
                                        "app.reload",
                                        label,
                                        true,
                                        accel.as_deref(),
                                    )?;
                                    submenu.append(&mi)?;
                                }
                                _ => {
                                    let mi = MenuItem::with_id(
                                        app,
                                        "help.devtools",
                                        label,
                                        true,
                                        accel.as_deref(),
                                    )?;
                                    submenu.append(&mi)?;
                                }
                            }
                        }
                    }
                }
                root_menu.append(&submenu)?;
            }
            app.set_menu(root_menu)?;
            // The in-app menu bar (renderer) is the single menu in every shell —
            // hide the native bar but keep the menu attached for accelerators.
            let _ = app.handle().hide_menu();

            let auto_save_handle = auto_save_handle.expect("checkbox menu item present");
            app.on_menu_event(move |_app, event| {
                let id = event.id().0.as_str();
                if id == "help.devtools" {
                    if let Some(window) = _app.get_webview_window("main") {
                        window.open_devtools();
                    }
                    return;
                }
                let payload: &str = if id == auto_save_id.as_str() {
                    if auto_save_handle.is_checked().unwrap_or(false) {
                        auto_save_on.as_str()
                    } else {
                        auto_save_off.as_str()
                    }
                } else {
                    id
                };
                // Payload rides the same host-event channel the frontend already listens on.
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.emit(
                        "host-event",
                        serde_json::json!({ "event": "menu-command", "payload": payload }),
                    );
                }
            });
            Ok(())
        })
        // `file-open` listeners only exist once the frontend ran `boot()`, so
        // association paths collected earlier are flushed here.
        .on_page_load(|webview, _payload| {
            flush_file_open(webview.app_handle());
        })
        .build(tauri::generate_context!())
        .expect("error while building Markup")
        .run(|_handle, _event| {
            // macOS delivers association opens — including the one that
            // launched the app — through this event, and the variant only
            // exists on macOS (elsewhere the path arrives as an argument).
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path) = path.to_str() {
                            deliver_file_open(_handle, path.to_string());
                        }
                    }
                }
            }
        });
}