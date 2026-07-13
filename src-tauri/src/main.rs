// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK Wayland renderer workaround — without these the webview crashes
    // on some Wayland sessions (incl. the original dev box). Must be set before
    // the webview initializes; an existing value wins so users can override.
    //
    // GDK_BACKEND=x11: run through XWayland even on a Wayland session. Native
    // Wayland silently breaks three overlay features at once — clients cannot
    // self-position windows (KWin centers them: the relic box landed mid-screen),
    // cannot keep-above (the box dropped behind whatever was focused), and
    // global hotkey grabs are unreliable. Under X11 all three work, and the
    // game itself is an XWayland client anyway. Overridable like the rest.
    #[cfg(target_os = "linux")]
    for (k, v) in [
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
        ("GDK_BACKEND", "x11"),
    ] {
        if std::env::var_os(k).is_none() {
            std::env::set_var(k, v);
        }
    }
    wfit_lib::run();
}
