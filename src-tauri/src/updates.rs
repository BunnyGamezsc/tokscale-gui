use tauri::AppHandle;

/// On macOS Sparkle presents its own update UI. On Windows and Linux the
/// frontend confirms an available version before calling `install_update`.
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_sparkle_updater::SparkleUpdaterExt;
        let updater = app.sparkle_updater().ok_or("Updates require the installed app bundle")?;
        updater.check_for_updates().map_err(|error| error.to_string())?;
        Ok(None)
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        use tauri_plugin_updater::UpdaterExt;
        let update = app
            .updater()
            .map_err(|error| error.to_string())?
            .check()
            .await
            .map_err(|error| error.to_string())?;
        Ok(update.map(|available| available.version))
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        use tauri_plugin_updater::UpdaterExt;
        let Some(update) = app
            .updater()
            .map_err(|error| error.to_string())?
            .check()
            .await
            .map_err(|error| error.to_string())?
        else {
            return Err("No update is available".into());
        };
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|error| error.to_string())?;
        app.restart();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return Err("Sparkle handles installation on macOS".into());
    }
    #[allow(unreachable_code)]
    Ok(())
}
