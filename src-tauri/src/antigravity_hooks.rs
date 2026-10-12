use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const HOOK_NAME: &str = "dot-notifier-agent-status";
const SCRIPT_NAME: &str = "antigravity-notify.ps1";

pub fn is_enabled(app: &AppHandle) -> Result<bool, String> {
    let path = hooks_path(app)?;
    let Some(config) = read_config(&path)? else {
        return Ok(false);
    };
    let hook_registered = config.get(HOOK_NAME).is_some_and(contains_our_script);
    if !hook_registered {
        return Ok(false);
    }

    let installed_script = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("hooks")
        .join(SCRIPT_NAME);
    Ok(installed_script.is_file())
}

pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    let path = hooks_path(app)?;
    let mut config = read_config(&path)?.unwrap_or_else(|| json!({}));
    let entries = config
        .as_object_mut()
        .ok_or_else(|| "Antigravity hooks.json must contain a JSON object".to_string())?;

    if enabled {
        if let Some(existing) = entries.get(HOOK_NAME) {
            if !contains_our_script(existing) {
                return Err(format!(
                    "Antigravity hook name {HOOK_NAME} is already used by another integration"
                ));
            }
        }
        let script_path = install_script(app)?;
        let hook = hook_definition(&script_path);
        if entries
            .get(HOOK_NAME)
            .is_some_and(|existing| existing == &hook)
        {
            return Ok(true);
        }
        entries.insert(HOOK_NAME.to_string(), hook);
    } else {
        let Some(existing) = entries.get(HOOK_NAME) else {
            return Ok(false);
        };
        if !contains_our_script(existing) {
            return Err(format!(
                "Antigravity hook name {HOOK_NAME} does not belong to Dot Notifier"
            ));
        }
        entries.remove(HOOK_NAME);
    }

    write_config(&path, &config)?;
    Ok(enabled)
}

fn hooks_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map(|home| home.join(".gemini").join("config").join("hooks.json"))
        .map_err(|error| error.to_string())
}

fn read_config(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("Could not read Antigravity hooks.json: {error}"))
}

fn install_script(app: &AppHandle) -> Result<PathBuf, String> {
    let script_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("hooks");
    fs::create_dir_all(&script_dir).map_err(|error| error.to_string())?;
    let script_path = script_dir.join(SCRIPT_NAME);
    fs::write(
        &script_path,
        include_str!("../../scripts/antigravity-notify.ps1"),
    )
    .map_err(|error| error.to_string())?;
    Ok(script_path)
}

fn hook_definition(script_path: &Path) -> Value {
    let script_path = script_path.to_string_lossy();
    let command = |event: &str| {
        format!(
            "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script_path}\" -Agent auto -Event {event}"
        )
    };
    json!({
        "PreInvocation": [{
            "type": "command",
            "command": command("PreInvocation"),
            "timeout": 2
        }],
        "Stop": [{
            "type": "command",
            "command": command("Stop"),
            "timeout": 2
        }]
    })
}

fn contains_our_script(value: &Value) -> bool {
    value
        .to_string()
        .to_ascii_lowercase()
        .contains(&SCRIPT_NAME.to_ascii_lowercase())
}

fn write_config(path: &Path, config: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Antigravity hooks path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if path.exists() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis();
        let backup = path.with_extension(format!("json.bak-{timestamp}"));
        fs::copy(path, backup).map_err(|error| error.to_string())?;
    }
    let serialized = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}
