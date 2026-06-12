// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK Wayland renderer workaround — without these the webview crashes
    // on some Wayland sessions (incl. the original dev box). Must be set before
    // the webview initializes; an existing value wins so users can override.
    #[cfg(target_os = "linux")]
    for (k, v) in [
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
    ] {
        if std::env::var_os(k).is_none() {
            std::env::set_var(k, v);
        }
    }
    wfit_lib::run();
}
