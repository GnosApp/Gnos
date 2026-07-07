use std::path::PathBuf;
use std::process::Command;
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

fn set_app_icon(window: &tauri::WebviewWindow, theme: tauri::Theme) {
    let icon_bytes: &[u8] = match theme {
        tauri::Theme::Light => include_bytes!("../icons/icon-light.png"),
        _ => include_bytes!("../icons/icon-dark.png"),
    };
    if let Ok(img) = image::load_from_memory(icon_bytes) {
        let (w, h) = (img.width(), img.height());
        let rgba = img.into_rgba8().into_raw();
        let icon = tauri::image::Image::new_owned(rgba, w, h);
        let _ = window.set_icon(icon);
    }
}

/// Get the piper models directory
fn piper_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("piper")
}

/// List available voice models
#[tauri::command]
async fn piper_list_voices(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = piper_dir(&app).join("models");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut voices = vec![];
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".onnx") {
            voices.push(name.trim_end_matches(".onnx").to_string());
        }
    }
    Ok(voices)
}

/// Synthesize speech from text using piper CLI
#[tauri::command]
async fn piper_speak(
    app: tauri::AppHandle,
    text: String,
    voice: String,
    speed: Option<f32>,
) -> Result<String, String> {
    let piper_path = piper_dir(&app);
    let bin = if cfg!(target_os = "windows") {
        piper_path.join("piper.exe")
    } else {
        piper_path.join("piper")
    };

    if !bin.exists() {
        return Err("Piper not installed. Download it from Settings > TTS.".to_string());
    }

    let model_path = piper_path.join("models").join(format!("{}.onnx", voice));
    if !model_path.exists() {
        return Err(format!("Voice model '{}' not found", voice));
    }

    // Output to a temp WAV file
    let output_path = piper_path.join("output.wav");

    let mut cmd = Command::new(&bin);
    cmd.arg("--model")
        .arg(&model_path)
        .arg("--output_file")
        .arg(&output_path);

    if let Some(spd) = speed {
        cmd.arg("--length_scale")
            .arg(format!("{:.2}", 1.0 / spd));
    }

    // Pipe text via stdin
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start piper: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Piper failed: {}", stderr));
    }

    Ok(output_path.to_string_lossy().to_string())
}

/// Create a child webview at the given logical coordinates inside the main window.
/// Requires the "unstable" Tauri feature.
#[tauri::command]
async fn create_inline_webview(
    app: tauri::AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let parsed_url = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    window
        .add_child(
            tauri::WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed_url)),
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

/// Reposition / resize an inline child webview
#[tauri::command]
async fn reposition_inline_webview(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close an inline child webview
#[tauri::command]
async fn close_inline_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Fetch og:image (or twitter:image) from a page's HTML head.
/// Streams only until </head> or 64 KB so it is fast.
#[tauri::command]
async fn fetch_og_image(url: String) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // Stream only until </head> or 64 KB
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(65536);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.extend_from_slice(&chunk);
        if buf.len() >= 65536 { break; }
        if let Ok(s) = std::str::from_utf8(&buf) {
            if s.to_ascii_lowercase().contains("</head>") { break; }
        }
    }

    let html = String::from_utf8_lossy(&buf);
    for prop in &["og:image", "twitter:image"] {
        if let Some(img_url) = extract_meta_content(&html, prop) {
            return Ok(Some(resolve_url(&url, &img_url)));
        }
    }
    Ok(None)
}

fn extract_meta_content(html: &str, property: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let prop_lower = property.to_ascii_lowercase();
    let mut pos = 0;
    while let Some(meta_off) = lower[pos..].find("<meta") {
        let meta_pos = pos + meta_off;
        let tag_end = lower[meta_pos..].find('>').map(|p| meta_pos + p + 1).unwrap_or(html.len());
        let tag = &html[meta_pos..tag_end];
        let tag_lower = &lower[meta_pos..tag_end];
        let has_prop = tag_lower.contains(&format!("property=\"{}\"", prop_lower))
            || tag_lower.contains(&format!("property='{}'",  prop_lower))
            || tag_lower.contains(&format!("name=\"{}\"",    prop_lower))
            || tag_lower.contains(&format!("name='{}'",      prop_lower));
        if has_prop {
            if let Some(content) = extract_attr_value(tag, "content") {
                return Some(content);
            }
        }
        pos = tag_end;
    }
    None
}

fn extract_attr_value(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    // Try attr="..."
    let dq = format!("{}=\"", attr.to_ascii_lowercase());
    if let Some(p) = lower.find(&dq) {
        let start = p + dq.len();
        let end = tag[start..].find('"')? + start;
        return Some(tag[start..end].trim().to_string());
    }
    // Try attr='...'
    let sq = format!("{}='", attr.to_ascii_lowercase());
    if let Some(p) = lower.find(&sq) {
        let start = p + sq.len();
        let end = tag[start..].find('\'')? + start;
        return Some(tag[start..end].trim().to_string());
    }
    None
}

fn resolve_url(base: &str, img_url: &str) -> String {
    if img_url.starts_with("https://") || img_url.starts_with("http://") {
        return img_url.to_string();
    }
    if img_url.starts_with("//") {
        let proto = if base.starts_with("https") { "https:" } else { "http:" };
        return format!("{}{}", proto, img_url);
    }
    if img_url.starts_with('/') {
        let proto = if base.starts_with("https") { "https" } else { "http" };
        let after = base.strip_prefix("https://").or_else(|| base.strip_prefix("http://")).unwrap_or(base);
        let host = after.split('/').next().unwrap_or("");
        return format!("{}://{}{}", proto, host, img_url);
    }
    img_url.to_string()
}

// ── Updater ───────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    current_version: String,
    body: Option<String>,
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => Ok(Some(UpdateInfo {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            body: update.body.clone(),
        })),
        None => Ok(None),
    }
}

#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        let handle = app.clone();
        update
            .download_and_install(
                move |chunk_length, content_length| {
                    let _ = handle.emit(
                        "update-download-progress",
                        serde_json::json!({
                            "chunk": chunk_length,
                            "total": content_length,
                        }),
                    );
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

// ── Quick Note popup ──────────────────────────────────────────────────────────

/// Toggle the frameless always-on-top quick note window.
/// Summoned by the global shortcut; also callable from the frontend.
fn toggle_quick_note(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("quicknote") {
        if win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit("quicknote:focus", ());
        }
        return;
    }
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "quicknote",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Quick Note")
    .inner_size(400.0, 540.0)
    .min_inner_size(280.0, 240.0)
    .decorations(false)
    .transparent(true)
    // macOS draws a native rectangular drop shadow around borderless/transparent
    // windows, following the window bounds (not the rounded .qn-card). It compounded
    // with the card + fan CSS shadows into a ragged halo — kill it, keep only CSS.
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .accept_first_mouse(true);
    match builder.build() {
        Ok(w) => {
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("[Gnos] quick note window failed: {}", e),
    }
}

#[tauri::command]
async fn quick_note_toggle(app: tauri::AppHandle) {
    toggle_quick_note(&app);
}

/// Dedicated macOS-style settings window (label "settings").
/// Overlay title bar so the sidebar runs full height, like System Settings.
#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Settings")
    .inner_size(780.0, 560.0)
    .min_inner_size(640.0, 420.0);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let win = builder.build().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

/// Profile window (label "profile") — stats, streak, reading log.
#[tauri::command]
async fn open_profile_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("profile") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "profile",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Profile")
    .inner_size(560.0, 640.0)
    .min_inner_size(440.0, 480.0);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let win = builder.build().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

/// Open a folder in the system file manager (Finder on macOS, Explorer on Windows, etc.)
#[tauri::command]
async fn open_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Copy a file's bytes — used for drag-drop from Finder where FS scope may not cover the path
#[tauri::command]
async fn copy_file_bytes(source: String) -> Result<Vec<u8>, String> {
    std::fs::read(&source).map_err(|e| format!("Failed to read {}: {}", source, e))
}

// ── Plugin system ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
struct PluginManifest {
    id: String,
    name: String,
    version: String,
    #[serde(rename = "minAppVersion", default)]
    min_app_version: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_main")]
    main: String,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    bundled: bool,
}

fn default_main() -> String { "index.js".to_string() }

/// List all community plugins found in {archive_path}/plugins/
/// Returns a list of (manifest, enabled) pairs.
#[tauri::command]
async fn plugin_list(plugins_dir: String) -> Result<Vec<PluginManifest>, String> {
    let dir = std::path::Path::new(&plugins_dir);
    if !dir.exists() { return Ok(vec![]) }
    let mut manifests = vec![];
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue }
        let manifest_path = entry.path().join("manifest.json");
        if !manifest_path.exists() { continue }
        match std::fs::read_to_string(&manifest_path) {
            Ok(raw) => match serde_json::from_str::<PluginManifest>(&raw) {
                Ok(m) => manifests.push(m),
                Err(e) => eprintln!("[Gnos] Bad manifest in {:?}: {}", manifest_path, e),
            },
            Err(e) => eprintln!("[Gnos] Cannot read manifest {:?}: {}", manifest_path, e),
        }
    }
    Ok(manifests)
}

/// Read the JS bundle for a community plugin.
/// plugins_dir is the full path to the plugins/ folder.
#[tauri::command]
async fn plugin_load_bundle(plugins_dir: String, plugin_id: String, main_file: String) -> Result<String, String> {
    let path = std::path::Path::new(&plugins_dir)
        .join(&plugin_id)
        .join(&main_file);
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read plugin bundle {:?}: {}", path, e))
}

/// Create the plugins directory if it doesn't exist.
#[tauri::command]
async fn plugin_ensure_dir(plugins_dir: String) -> Result<(), String> {
    std::fs::create_dir_all(&plugins_dir).map_err(|e| e.to_string())
}

/// Fetch the community plugin registry JSON from a URL.
#[tauri::command]
async fn plugin_fetch_registry(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Gnos/0.1")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let body = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(body)
}

/// Download and install a community plugin from GitHub release assets.
/// Creates {plugins_dir}/{plugin_id}/manifest.json and index.js.
#[tauri::command]
async fn plugin_install(
    plugins_dir: String,
    plugin_id: String,
    manifest_url: String,
    bundle_url: String,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("Gnos/0.1")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let plugin_dir = std::path::Path::new(&plugins_dir).join(&plugin_id);
    std::fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;

    // Download manifest
    let manifest_bytes = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {}", e))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::write(plugin_dir.join("manifest.json"), &manifest_bytes)
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    // Download bundle
    let bundle_bytes = client
        .get(&bundle_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch bundle: {}", e))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::write(plugin_dir.join("index.js"), &bundle_bytes)
        .map_err(|e| format!("Failed to write bundle: {}", e))?;

    Ok(())
}

/// Remove a community plugin's folder from the plugins directory.
#[tauri::command]
async fn plugin_uninstall(plugins_dir: String, plugin_id: String) -> Result<(), String> {
    let plugin_dir = std::path::Path::new(&plugins_dir).join(&plugin_id);
    if plugin_dir.exists() {
        std::fs::remove_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Check if piper binary is installed
#[tauri::command]
async fn piper_check(app: tauri::AppHandle) -> Result<bool, String> {
    let piper_path = piper_dir(&app);
    let bin = if cfg!(target_os = "windows") {
        piper_path.join("piper.exe")
    } else {
        piper_path.join("piper")
    };
    Ok(bin.exists())
}

/// Install bundled piper binary + voices from app resources into app_data_dir/piper/
/// Skips files that already exist (idempotent). Call on startup.
#[tauri::command]
async fn piper_install_bundled(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri::Manager;
    let dest_dir = piper_dir(&app);
    let models_dir = dest_dir.join("models");
    std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let piper_resources = resource_dir.join("piper");

    if !piper_resources.exists() {
        return Ok(vec![]); // no bundled resources — silently no-op
    }

    let mut installed = vec![];

    // Copy binary
    let bin_src = if cfg!(target_os = "windows") {
        piper_resources.join("piper.exe")
    } else {
        piper_resources.join("piper")
    };
    let bin_dst = if cfg!(target_os = "windows") {
        dest_dir.join("piper.exe")
    } else {
        dest_dir.join("piper")
    };
    if bin_src.exists() && !bin_dst.exists() {
        std::fs::copy(&bin_src, &bin_dst).map_err(|e| format!("copy binary: {}", e))?;
        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&bin_dst).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&bin_dst, perms).map_err(|e| e.to_string())?;
        }
        installed.push("piper".to_string());
    }

    // Copy model files (.onnx + .onnx.json)
    let models_src = piper_resources.join("models");
    if models_src.exists() {
        for entry in std::fs::read_dir(&models_src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            let dst = models_dir.join(&name);
            if !dst.exists() {
                std::fs::copy(entry.path(), &dst).map_err(|e| format!("copy {}: {}", name, e))?;
                if name.ends_with(".onnx") {
                    installed.push(name.trim_end_matches(".onnx").to_string());
                }
            }
        }
    }

    Ok(installed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
          if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            toggle_quick_note(app);
          }
        })
        .build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let handle = app.handle();

      let gnos = SubmenuBuilder::new(handle, "Gnos")
        .item(&tauri::menu::MenuItem::with_id(handle, "about", "About Gnos", true, None::<&str>)?)
        .item(&PredefinedMenuItem::separator(handle)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "open_profile", "Profile…", true, None::<&str>)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "profile_settings", "Settings…", true, Some("CmdOrCtrl+,"))?)
        .build()?;

      let books = SubmenuBuilder::new(handle, "Books")
        .item(&tauri::menu::MenuItem::with_id(handle, "import", "Import Book", true, None::<&str>)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "new_notebook", "New Notebook", true, None::<&str>)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "new_sketchbook", "New Sketchbook", true, None::<&str>)?)
        .build()?;

      let edit = SubmenuBuilder::new(handle, "Edit")
        .item(&PredefinedMenuItem::undo(handle, None)?)
        .item(&PredefinedMenuItem::redo(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(handle, None)?)
        .item(&PredefinedMenuItem::copy(handle, None)?)
        .item(&PredefinedMenuItem::paste(handle, None)?)
        .item(&PredefinedMenuItem::select_all(handle, None)?)
        .build()?;

      let actions = SubmenuBuilder::new(handle, "Actions")
        .item(&tauri::menu::MenuItem::with_id(handle, "undo", "Undo", true, None::<&str>)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "redo", "Redo", true, None::<&str>)?)
        .build()?;

      let view = SubmenuBuilder::new(handle, "View")
        .item(&tauri::menu::MenuItem::with_id(handle, "tab_library", "Library", true, Some("CmdOrCtrl+1"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "tab_books", "Books", true, Some("CmdOrCtrl+2"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "tab_audiobooks", "Audiobooks", true, Some("CmdOrCtrl+3"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "tab_notebooks", "Notebooks", true, Some("CmdOrCtrl+4"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "tab_collections", "Collections", true, Some("CmdOrCtrl+5"))?)
        .item(&PredefinedMenuItem::separator(handle)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "filter_all", "Show Everything", true, Some("CmdOrCtrl+Alt+0"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "filter_book", "Show Books", true, Some("CmdOrCtrl+Alt+1"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "filter_audio", "Show Audio", true, Some("CmdOrCtrl+Alt+2"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "filter_notebook", "Show Notes", true, Some("CmdOrCtrl+Alt+3"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "filter_sketchbook", "Show Sketches", true, Some("CmdOrCtrl+Alt+4"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "filter_flashcard", "Show Cards", true, Some("CmdOrCtrl+Alt+5"))?)
        .item(&PredefinedMenuItem::separator(handle)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "manage_collections", "Manage Collections…", true, Some("CmdOrCtrl+Shift+M"))?)
        .item(&PredefinedMenuItem::separator(handle)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "customize_toolbar", "Customize Toolbar…", true, None::<&str>)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "page_settings", "Page Settings…", true, Some("CmdOrCtrl+Alt+,"))?)
        .build()?;

      let window_menu = SubmenuBuilder::new(handle, "Window")
        .item(&PredefinedMenuItem::minimize(handle, Some("Minimize"))?)
        .item(&PredefinedMenuItem::maximize(handle, Some("Zoom"))?)
        .item(&tauri::menu::MenuItem::with_id(handle, "fullscreen", "Enter Full Screen", true, Some("Ctrl+Command+F"))?)
        .build()?;

      let menu = MenuBuilder::new(handle)
        .items(&[&gnos, &edit, &books, &actions, &view, &window_menu])
        .build()?;

      app.set_menu(menu)?;

      // Quick note summon shortcut — Option+N (Alt+N), works while any app is focused.
      {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        if let Err(e) = app.global_shortcut().register("Alt+N") {
          eprintln!("[Gnos] quick note shortcut registration failed: {}", e);
        }
      }

      let window = app.get_webview_window("main").unwrap();

      #[cfg(target_os = "macos")]
      {
        use tauri::TitleBarStyle;
        window.set_title_bar_style(TitleBarStyle::Overlay)?;
      }

      #[cfg(any(target_os = "windows", target_os = "linux"))]
      {
        window.set_decorations(true)?;
      }

      // Set icon based on current system theme, and update on theme change
      let initial_theme = window.theme().unwrap_or(tauri::Theme::Dark);
      set_app_icon(&window, initial_theme);
      let window_for_theme = window.clone();
      window.on_window_event(move |event| {
        if let tauri::WindowEvent::ThemeChanged(theme) = event {
          set_app_icon(&window_for_theme, *theme);
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      piper_list_voices,
      piper_speak,
      piper_check,
      piper_install_bundled,
      plugin_list,
      plugin_load_bundle,
      plugin_ensure_dir,
      plugin_fetch_registry,
      plugin_install,
      plugin_uninstall,
      copy_file_bytes,
      open_in_finder,
      quick_note_toggle,
      open_settings_window,
      open_profile_window,
      create_inline_webview,
      reposition_inline_webview,
      close_inline_webview,
      fetch_og_image,
      check_for_updates,
      download_and_install_update,
    ])
    .on_menu_event(|app, event| {
      let id = event.id().as_ref();
      if id == "fullscreen" {
        if let Some(win) = app.get_webview_window("main") {
          let is_fs = win.is_fullscreen().unwrap_or(false);
          let _ = win.set_fullscreen(!is_fs);
        }
        return;
      }
      app.emit("menu", id).unwrap();
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}