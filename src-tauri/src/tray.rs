//! One read-only total, updated by the same local projection as the views.
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

pub(crate) fn setup(app: &tauri::App) -> tauri::Result<()> {
    // A small template T. macOS supplies the appropriate menu-bar foreground.
    let mut pixels = vec![0u8; 18 * 18 * 4];
    for y in 3..15 {
        for x in 3..15 {
            if y < 6 || (7..11).contains(&x) {
                pixels[(y * 18 + x) * 4 + 3] = 255;
            }
        }
    }
    let icon = tauri::image::Image::new_owned(pixels, 18, 18);
    #[cfg(not(target_os = "macos"))]
    let icon = app.default_window_icon().cloned().unwrap_or(icon);
    TrayIconBuilder::with_id("spending")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .title("Scan needed")
        .tooltip("Tokscale: run a scan to see today's local spending")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

pub(crate) fn update(
    app: &tauri::AppHandle,
    today: &str,
    cost: f64,
    complete: bool,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("spending") {
        let marker = if complete { "" } else { "*" };
        tray.set_title(Some(format!("${cost:.2}{marker} today")))
            .map_err(|e| e.to_string())?;
        let refreshed = chrono::Local::now().format("%H:%M");
        tray.set_tooltip(Some(format!("Tokscale · local usage for {today}: ${cost:.2}{marker}\nUpdated {refreshed} from the last shared scan. Click to open.{}", if complete { "" } else { "\n* Some usage has no price." }))).map_err(|e| e.to_string())?;
    }
    Ok(())
}
