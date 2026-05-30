mod db;
mod market;
mod commands;
mod types;
mod error;

use std::sync::Arc;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db: db::Db,
    pub market: market::Market,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,wfinv_lib=debug")))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("create app data dir");
            let db_path = app_data_dir.join("db.sqlite");
            tracing::info!(?db_path, "opening database");
            let db = db::Db::open(&db_path).expect("open db");
            let market = market::Market::new();
            app.manage(Arc::new(AppState { db, market }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::catalog_count,
            commands::catalog_refresh,
            commands::inventory_add,
            commands::inventory_list,
            commands::inventory_set_qty,
            commands::inventory_remove,
            commands::sale_record,
            commands::sale_list,
            commands::prices_refresh,
            commands::summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
