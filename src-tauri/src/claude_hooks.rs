use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const HOOK_SCRIPT: &str = "dot-notifier-claude-notify.ps1";
const HOOK_SOURCE: &str = include_str!("../../scripts/claude-notify.ps1");
const HOOK_EVENTS: [(&str, Option<&str>); 4] = [
    ("UserPromptSubmit", None),
    ("Stop", None),
    ("Notification", Some("idle_prompt|agent_needs_input")),
    ("PermissionRequest", None),
];

pub fn is_enabled(app: &AppHandle) -> Result<bool, String> {
    let config_path = settings_path(app)?;
    let Some(config) = read_config(&config_path)? else {
        return Ok(false);
    };
    let script_path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("hooks")
        .join(HOOK_SCRIPT);
    let installed_script = fs::read(&script_path).ok();
    Ok(integration_is_enabled(&config, installed_script.as_deref()))
}

fn integration_is_enabled(config: &Value, installed_script: Option<&[u8]>) -> bool {
    installed_script.is_some_and(|script| script == HOOK_SOURCE.as_bytes())
        && contains_our_hook(config)
}

pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    let config_path = settings_path(app)?;
    let mut config = read_config(&config_path)?.unwrap_or_else(|| json!({}));
    let original = config.clone();
    remove_our_hooks(&mut config)?;
    if enabled {
        let script_path = install_script(app)?;
        add_our_hooks(&mut config, &script_path)?;
    }
    if config != original {
        write_config(&config_path, &config)?;
    }
    Ok(enabled)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map(|home| home.join(".claude").join("settings.json"))
        .map_err(|error| error.to_string())
}

fn read_config(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("Could not read Claude Code settings.json: {error}"))
}

fn install_script(app: &AppHandle) -> Result<PathBuf, String> {
    let script_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("hooks");
    fs::create_dir_all(&script_dir).map_err(|error| error.to_string())?;
    let script_path = script_dir.join(HOOK_SCRIPT);
    fs::write(&script_path, HOOK_SOURCE).map_err(|error| error.to_string())?;
    Ok(script_path)
}

fn hook_handler(script_path: &Path, event: &str) -> Value {
    let script_path = script_path.to_string_lossy();
    json!({
        "type": "command",
        "command": format!(r#"powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{script_path}" -Event {event}"#),
        "async": true,
        "timeout": 2
    })
}

fn add_our_hooks(config: &mut Value, script_path: &Path) -> Result<(), String> {
    let root = config
        .as_object_mut()
        .ok_or_else(|| "Claude Code settings.json must contain an object".to_string())?;
    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks
        .as_object_mut()
        .ok_or_else(|| "Claude Code hooks setting must contain an object".to_string())?;
    for (event, matcher) in HOOK_EVENTS {
        let groups = hooks.entry(event).or_insert_with(|| json!([]));
        let groups = groups
            .as_array_mut()
            .ok_or_else(|| format!("Claude Code {event} hooks must contain an array"))?;
        let mut group = json!({ "hooks": [hook_handler(script_path, event)] });
        if let Some(matcher) = matcher {
            group["matcher"] = json!(matcher);
        }
        groups.push(group);
    }
    Ok(())
}

fn remove_our_hooks(config: &mut Value) -> Result<(), String> {
    let Some(root) = config.as_object_mut() else {
        return Err("Claude Code settings.json must contain an object".to_string());
    };
    let Some(hooks) = root.get_mut("hooks") else {
        return Ok(());
    };
    let Some(hooks) = hooks.as_object_mut() else {
        return Err("Claude Code hooks setting must contain an object".to_string());
    };
    for (event, _) in HOOK_EVENTS {
        let Some(groups) = hooks.get_mut(event) else {
            continue;
        };
        let groups = groups
            .as_array_mut()
            .ok_or_else(|| format!("Claude Code {event} hooks must contain an array"))?;
        groups.retain_mut(|group| {
            let Some(entries) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                return true;
            };
            entries.retain(|entry| !is_our_hook(entry));
            !entries.is_empty()
        });
        if groups.is_empty() {
            hooks.remove(event);
        }
    }
    Ok(())
}

fn is_our_hook(entry: &Value) -> bool {
    entry
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.to_ascii_lowercase().contains(HOOK_SCRIPT))
}

fn contains_our_hook(config: &Value) -> bool {
    HOOK_EVENTS.iter().all(|(event, _)| {
        config
            .get("hooks")
            .and_then(|hooks| hooks.get(event))
            .and_then(Value::as_array)
            .is_some_and(|groups| {
                groups.iter().any(|group| {
                    group
                        .get("hooks")
                        .and_then(Value::as_array)
                        .is_some_and(|entries| entries.iter().any(is_our_hook))
                })
            })
    })
}

fn write_config(path: &Path, config: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Claude Code settings path has no parent directory".to_string())?;
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{add_our_hooks, contains_our_hook, integration_is_enabled, remove_our_hooks};

    #[test]
    fn outdated_claude_script_requires_reinstallation() {
        let mut config = json!({});
        add_our_hooks(
            &mut config,
            std::path::Path::new(r"C:\app data\dot-notifier-claude-notify.ps1"),
        )
        .expect("hooks are added");

        assert!(integration_is_enabled(
            &config,
            Some(include_bytes!("../../scripts/claude-notify.ps1"))
        ));
        assert!(!integration_is_enabled(
            &config,
            Some(b"outdated hook script")
        ));
        assert!(!integration_is_enabled(&config, None));
    }

    #[test]
    fn claude_script_resolves_bus_session_from_its_install_directory() {
        let script = include_str!("../../scripts/claude-notify.ps1");

        assert!(script.contains(
            "$sessionPath = Join-Path (Split-Path -Parent $PSScriptRoot) \"bus-session.json\""
        ));
    }

    #[test]
    fn adds_async_observers_and_preserves_existing_hooks() {
        let mut config = json!({
            "theme": "dark",
            "hooks": {
                "Stop": [{"hooks": [{"type": "command", "command": "other-hook"}]}]
            }
        });
        add_our_hooks(
            &mut config,
            std::path::Path::new(r"C:\app data\dot-notifier-claude-notify.ps1"),
        )
        .expect("hooks are added");

        assert_eq!(config["theme"], "dark");
        assert!(
            config["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"]
                .as_str()
                .is_some_and(|command| command.contains("-Event UserPromptSubmit"))
        );
        assert_eq!(config["hooks"]["Stop"].as_array().map(Vec::len), Some(2));
        assert!(config["hooks"]["PermissionRequest"][0]["hooks"][0]["async"] == true);
        assert!(config["hooks"]["Notification"][0]["matcher"]
            .as_str()
            .is_some_and(|matcher| matcher.contains("agent_needs_input")));
        assert!(contains_our_hook(&config));
    }

    #[test]
    fn removes_only_our_entries_and_keeps_other_hook_fields() {
        let mut config = json!({
            "hooks": {
                "Stop": [{
                    "matcher": "",
                    "hooks": [
                        {"type": "command", "command": "powershell -File dot-notifier-claude-notify.ps1"},
                        {"type": "command", "command": "user-hook"}
                    ]
                }],
                "Notification": [{"matcher": "permission_prompt", "hooks": [{"type": "command", "command": "user-notification"}]}]
            }
        });
        remove_our_hooks(&mut config).expect("our hooks are removed");

        assert_eq!(
            config["hooks"]["Stop"][0]["hooks"].as_array().map(Vec::len),
            Some(1)
        );
        assert_eq!(
            config["hooks"]["Stop"][0]["hooks"][0]["command"],
            "user-hook"
        );
        assert_eq!(
            config["hooks"]["Notification"][0]["matcher"],
            "permission_prompt"
        );
        assert!(!contains_our_hook(&config));
    }
}
