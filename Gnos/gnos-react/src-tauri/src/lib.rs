use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_dialog::init())
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
        .build()?;

      let books = SubmenuBuilder::new(handle, "Books")
        .item(&tauri::menu::MenuItem::with_id(handle, "import", "Import Book", true, None::<&str>)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "new_notebook", "New Notebook", true, None::<&str>)?)
        .item(&tauri::menu::MenuItem::with_id(handle, "new_sketchbook", "New Sketchbook", true, None::<&str>)?)
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
        .build()?;

      let menu = MenuBuilder::new(handle)
        .items(&[&gnos, &books, &actions, &view])
        .build()?;

      app.set_menu(menu)?;

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

      Ok(())
    })
    .on_menu_event(|app, event| {
      app.emit("menu", event.id().as_ref()).unwrap();
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}