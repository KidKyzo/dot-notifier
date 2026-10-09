use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewWindow};

mod bus;
mod codex_logs;
mod notification_filter;
mod system_monitor;
mod win_notifications;

#[derive(Default)]
struct AppState {
    paused: AtomicBool,
    quiet_mode: AtomicBool,
    focus_session_active: std::sync::Arc<AtomicBool>,
    system_panel_open: std::sync::Arc<AtomicBool>,
    hit_area: Mutex<Option<HitArea>>,
}

#[derive(Clone, Copy, Deserialize)]
struct HitArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorOption {
    key: String,
    label: String,
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

fn monitor_key(monitor: &tauri::Monitor) -> String {
    let position = monitor.position();
    format!(
        "{}:{}:{}",
        monitor.name().map_or("Display", String::as_str),
        position.x,
        position.y
    )
}

impl HitArea {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

#[tauri::command]
fn update_hit_area(state: tauri::State<'_, AppState>, area: HitArea) {
    if area.x.is_finite()
        && area.y.is_finite()
        && area.width.is_finite()
        && area.height.is_finite()
        && area.width > 0.0
        && area.height > 0.0
    {
        if let Ok(mut hit_area) = state.hit_area.lock() {
            *hit_area = Some(area);
        }
    }
}

#[tauri::command]
fn set_system_panel_open(state: tauri::State<'_, AppState>, open: bool) {
    state.system_panel_open.store(open, Ordering::Relaxed);
}

fn place_on_work_area(
    window: &WebviewWindow,
    corner: &Corner,
    requested_monitor_key: Option<&str>,
) -> tauri::Result<()> {
    let monitors = window.available_monitors()?;
    let monitor = requested_monitor_key
        .and_then(|key| monitors.iter().find(|monitor| monitor_key(monitor) == key))
        .cloned()
        .or(window.primary_monitor()?);
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let window_size = window.outer_size()?;
    let margin = (20.0 * scale).round() as i32;
    let (x, y) = position_for(
        (
            work_area.position.x,
            work_area.position.y,
            work_area.size.width,
            work_area.size.height,
        ),
        (window_size.width, window_size.height),
        margin,
        corner,
    );
    window.set_position(PhysicalPosition::new(x, y))
}

fn position_for(
    area: (i32, i32, u32, u32),
    window_size: (u32, u32),
    margin: i32,
    corner: &Corner,
) -> (i32, i32) {
    let (left, top, area_width, area_height) = area;
    let (width, height) = window_size;
    let x = if matches!(corner, Corner::TopLeft | Corner::BottomLeft) {
        left + margin
    } else {
        left + area_width as i32 - width as i32 - margin
    };
    let y = if matches!(corner, Corner::BottomLeft | Corner::BottomRight) {
        top + area_height as i32 - height as i32 - margin
    } else {
        top + margin
    };
    (x, y)
}

#[tauri::command]
fn list_monitors(window: WebviewWindow) -> tauri::Result<Vec<MonitorOption>> {
    let primary_key = window.primary_monitor()?.as_ref().map(monitor_key);
    window.available_monitors().map(|mut monitors| {
        monitors.sort_by_key(|monitor| {
            !primary_key
                .as_ref()
                .is_some_and(|primary| monitor_key(monitor) == *primary)
        });
        monitors
            .into_iter()
            .map(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                MonitorOption {
                    key: monitor_key(&monitor),
                    label: monitor
                        .name()
                        .cloned()
                        .unwrap_or_else(|| format!("Display {},{}", position.x, position.y)),
                    width: size.width,
                    height: size.height,
                }
            })
            .collect()
    })
}

#[tauri::command]
fn set_placement(
    window: WebviewWindow,
    corner: Corner,
    monitor_key: Option<String>,
) -> tauri::Result<()> {
    place_on_work_area(&window, &corner, monitor_key.as_deref())
}

#[tauri::command]
fn set_auto_start(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut command = Command::new("reg.exe");
        if enabled {
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            let value = format!("\"{}\"", executable.display());
            command.args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "DotNotifier",
                "/t",
                "REG_SZ",
                "/d",
                &value,
                "/f",
            ]);
            let status = command.status().map_err(|error| error.to_string())?;
            if !status.success() {
                return Err(format!(
                    "Could not enable auto-start (exit code {:?})",
                    status.code()
                ));
            }
        } else {
            command.args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "DotNotifier",
                "/f",
            ]);
            let _ = command.status();
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("Auto-start is available on Windows only".into())
    }
}

#[tauri::command]
fn set_monitored_apps(app: tauri::AppHandle, mut apps: Vec<String>) -> Result<(), String> {
    if apps.len() > 100 || apps.iter().any(|name| name.len() > 128) {
        return Err("Notification filter is too large".into());
    }
    apps = apps
        .into_iter()
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .collect();
    if apps.is_empty() {
        apps.push("WhatsApp".into());
    }
    apps.sort_by_key(|name| name.to_lowercase());
    apps.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join("notification-filter.json");
    let temporary = directory.join("notification-filter.json.tmp");
    let contents = serde_json::to_vec_pretty(&serde_json::json!({ "monitoredApps": apps }))
        .map_err(|error| error.to_string())?;
    std::fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    std::fs::rename(temporary, destination).map_err(|error| error.to_string())
}

#[tauri::command]
fn check_notification_permission() -> bool {
    win_notifications::check_permission()
}

#[tauri::command]
fn request_notification_permission() -> Result<bool, String> {
    win_notifications::request_permission()
}

fn start_quiet_environment_poll(
    app: tauri::AppHandle,
    focus_session_active: std::sync::Arc<AtomicBool>,
) {
    #[cfg(windows)]
    {
        thread::spawn(move || {
            let focus_session_supported = initialize_focus_runtime();
            let mut previous = None;
            loop {
                let focus_active = focus_session_supported && windows_focus_session_active();
                focus_session_active.store(focus_active, Ordering::Relaxed);
                let quiet = windows_quiet_environment() || focus_active;
                if previous != Some(quiet) {
                    let _ = app.emit("quiet-environment", quiet);
                    previous = Some(quiet);
                }
                thread::sleep(Duration::from_millis(750));
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (app, focus_session_active);
    }
}

#[cfg(windows)]
fn initialize_focus_runtime() -> bool {
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    // The monitor owns this dedicated thread, so initializing its WinRT apartment is safe.
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok()
}

#[cfg(windows)]
fn windows_focus_session_active() -> bool {
    use windows::UI::Shell::FocusSessionManager;
    FocusSessionManager::IsSupported()
        .ok()
        .filter(|supported| *supported)
        .and_then(|_| FocusSessionManager::GetDefault().ok())
        .and_then(|manager| manager.IsFocusActive().ok())
        .unwrap_or(false)
}

#[tauri::command]
fn is_quiet_environment(state: tauri::State<'_, AppState>) -> bool {
    #[cfg(windows)]
    {
        windows_quiet_environment() || state.focus_session_active.load(Ordering::Relaxed)
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        false
    }
}

#[cfg(windows)]
fn windows_quiet_environment() -> bool {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHQueryUserNotificationState(state: *mut u32) -> i32;
    }
    let mut state = 0;
    // HRESULT is zero on success; unsupported states fail open so the overlay remains useful.
    let succeeded = unsafe { SHQueryUserNotificationState(&mut state) } >= 0;
    succeeded && matches!(state, 1 | 2 | 3 | 4 | 6)
}

fn start_cursor_poll(window: WebviewWindow) {
    let app = window.app_handle().clone();
    thread::spawn(move || {
        let mut last_ignore = None;
        loop {
            let current_state = app.state::<AppState>();
            let area = current_state.hit_area.lock().ok().and_then(|area| *area);
            let inside = area
                .and_then(|area| {
                    let cursor = global_cursor_position()?;
                    let origin = window.outer_position().ok()?;
                    let scale = window.scale_factor().ok()?;
                    let local_x = (cursor.0 - f64::from(origin.x)) / scale;
                    let local_y = (cursor.1 - f64::from(origin.y)) / scale;
                    Some(area.contains(local_x, local_y))
                })
                .unwrap_or(false);
            let ignore = !inside;
            if last_ignore != Some(ignore) {
                if let Err(error) = window.set_ignore_cursor_events(ignore) {
                    eprintln!("Could not update overlay click-through state: {error}");
                }
                last_ignore = Some(ignore);
            }
            thread::sleep(Duration::from_millis(60));
        }
    });
}

#[cfg(windows)]
fn global_cursor_position() -> Option<(f64, f64)> {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
    }

    let mut point = Point { x: 0, y: 0 };
    // GetCursorPos writes the screen-space cursor coordinates into the supplied point.
    let succeeded = unsafe { GetCursorPos(&mut point) } != 0;
    succeeded.then_some((f64::from(point.x), f64::from(point.y)))
}

#[cfg(not(windows))]
fn global_cursor_position() -> Option<(f64, f64)> {
    None
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let pause = CheckMenuItem::with_id(
        app,
        "pause",
        "Pause notifications",
        true,
        false,
        None::<&str>,
    )?;
    let quiet = CheckMenuItem::with_id(app, "quiet", "Quiet mode", true, false, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Open settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&pause, &quiet, &separator, &settings, &quit])?;

    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let state = app.state::<AppState>();
            match event.id().as_ref() {
                "pause" => {
                    let paused = !state.paused.load(Ordering::Relaxed);
                    state.paused.store(paused, Ordering::Relaxed);
                    let _ = pause.set_checked(paused);
                    let _ = app.emit("tray-controls", serde_json::json!({ "paused": paused }));
                }
                "quiet" => {
                    let quiet_mode = !state.quiet_mode.load(Ordering::Relaxed);
                    state.quiet_mode.store(quiet_mode, Ordering::Relaxed);
                    let _ = quiet.set_checked(quiet_mode);
                    let _ = app.emit(
                        "tray-controls",
                        serde_json::json!({ "quietMode": quiet_mode }),
                    );
                }
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    let _ = app.emit("tray-controls", serde_json::json!({ "openSettings": true }));
                }
                "quit" => app.exit(0),
                _ => {}
            }
        });
    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }
    let _tray = tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            update_hit_area,
            set_system_panel_open,
            list_monitors,
            set_placement,
            set_auto_start,
            set_monitored_apps,
            is_quiet_environment,
            check_notification_permission,
            request_notification_permission
        ])
        .setup(|app| {
            start_quiet_environment_poll(
                app.handle().clone(),
                app.state::<AppState>().focus_session_active.clone(),
            );
            system_monitor::start(
                app.handle().clone(),
                app.state::<AppState>().system_panel_open.clone(),
            );
            codex_logs::start(app.handle().clone());
            win_notifications::start(app.handle().clone());
            match app.path().app_local_data_dir() {
                Ok(directory) => {
                    if let Err(error) = bus::start(app.handle().clone(), &directory) {
                        eprintln!("Could not start local event bus: {error}");
                    }
                }
                Err(error) => eprintln!("Could not resolve event bus session directory: {error}"),
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = place_on_work_area(&window, &Corner::TopRight, None) {
                    eprintln!("Could not place overlay in the work area: {error}");
                }
                if let Err(error) = window.set_ignore_cursor_events(true) {
                    eprintln!("Could not enable overlay click-through: {error}");
                }
                start_cursor_poll(window);
            }
            setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{position_for, Corner, HitArea};

    #[test]
    fn hit_area_includes_top_left_and_excludes_bottom_right() {
        let area = HitArea {
            x: 10.0,
            y: 20.0,
            width: 40.0,
            height: 30.0,
        };

        assert!(area.contains(10.0, 20.0));
        assert!(area.contains(49.9, 49.9));
        assert!(!area.contains(50.0, 50.0));
        assert!(!area.contains(9.9, 20.0));
    }

    #[test]
    fn placement_uses_each_work_area_corner() {
        let area = (100, 200, 1_000, 800);
        let size = (380, 500);
        assert_eq!(position_for(area, size, 20, &Corner::TopLeft), (120, 220));
        assert_eq!(position_for(area, size, 20, &Corner::TopRight), (700, 220));
        assert_eq!(
            position_for(area, size, 20, &Corner::BottomLeft),
            (120, 480)
        );
        assert_eq!(
            position_for(area, size, 20, &Corner::BottomRight),
            (700, 480)
        );
    }
}
