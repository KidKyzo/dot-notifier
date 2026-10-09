use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

use serde::Deserialize;

use crate::bus::Event;

const DEDUP_RETENTION: Duration = Duration::from_secs(10 * 60);
const MAX_DEDUP_ENTRIES: usize = 4096;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilterConfig {
    #[serde(default = "default_monitored_apps")]
    monitored_apps: Vec<String>,
}

impl Default for FilterConfig {
    fn default() -> Self {
        Self {
            monitored_apps: default_monitored_apps(),
        }
    }
}

fn default_monitored_apps() -> Vec<String> {
    vec!["WhatsApp".into()]
}

pub struct NotificationFilter {
    monitored_apps: HashSet<String>,
    seen_notifications: HashMap<String, SeenNotification>,
    config_path: Option<std::path::PathBuf>,
    config_modified: Option<SystemTime>,
}

struct SeenNotification {
    seen_at: Instant,
    content: NotificationContent,
}

#[derive(PartialEq, Eq)]
struct NotificationContent {
    title: String,
    body: Option<String>,
}

impl NotificationFilter {
    pub fn load(path: &Path) -> Self {
        let contents = match fs::read_to_string(path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if let Err(write_error) =
                    fs::write(path, "{\n  \"monitoredApps\": [\"WhatsApp\"]\n}\n")
                {
                    eprintln!("Could not create notification filter configuration: {write_error}");
                }
                String::from("{\"monitoredApps\":[\"WhatsApp\"]}")
            }
            Err(error) => {
                eprintln!("Could not read notification filter configuration: {error}");
                String::from("{\"monitoredApps\":[\"WhatsApp\"]}")
            }
        };

        match parse_config(&contents) {
            Some(config) => {
                let mut filter = Self::from_config(config);
                filter.config_path = Some(path.to_path_buf());
                filter.config_modified = fs::metadata(path)
                    .and_then(|metadata| metadata.modified())
                    .ok();
                filter
            }
            None => {
                eprintln!("Ignoring malformed notification filter configuration");
                Self::from_config(FilterConfig::default())
            }
        }
    }

    fn from_config(config: FilterConfig) -> Self {
        Self {
            monitored_apps: config
                .monitored_apps
                .into_iter()
                .map(|app| app.trim().to_lowercase())
                .filter(|app| !app.is_empty())
                .collect(),
            seen_notifications: HashMap::new(),
            config_path: None,
            config_modified: None,
        }
    }

    fn refresh_if_changed(&mut self) {
        let Some(path) = self.config_path.as_deref() else {
            return;
        };
        let Ok(modified) = fs::metadata(path).and_then(|metadata| metadata.modified()) else {
            return;
        };
        if self.config_modified == Some(modified) {
            return;
        }
        let Ok(contents) = fs::read_to_string(path) else {
            return;
        };
        let Some(config) = parse_config(&contents) else {
            eprintln!("Ignoring malformed notification filter configuration");
            return;
        };
        self.monitored_apps = config
            .monitored_apps
            .into_iter()
            .map(|app| app.trim().to_lowercase())
            .filter(|app| !app.is_empty())
            .collect();
        self.config_modified = Some(modified);
    }

    pub fn should_forward(&mut self, event: &Event) -> bool {
        self.refresh_if_changed();
        if event.source != "chat" || event.kind != "message" {
            return true;
        }

        let metadata = event.meta.as_ref();
        let app = metadata
            .and_then(|meta| meta.get("app"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|app| !app.is_empty());

        if !self.monitored_apps.is_empty()
            && !app.is_some_and(|app| self.monitored_apps.contains(&app.to_lowercase()))
        {
            return false;
        }

        let Some(app) = app else {
            return true;
        };
        let Some(notification_id) = metadata
            .and_then(|meta| meta.get("notificationId"))
            .and_then(notification_id_string)
        else {
            return true;
        };

        let normalized_app = app.to_lowercase();
        let key = format!("{}:{normalized_app}{notification_id}", normalized_app.len());
        let content = NotificationContent {
            title: event.title.clone(),
            body: event.body.clone(),
        };
        let now = Instant::now();
        self.seen_notifications
            .retain(|_, seen| now.duration_since(seen.seen_at) < DEDUP_RETENTION);
        if self
            .seen_notifications
            .get(&key)
            .is_some_and(|seen| seen.content == content)
        {
            return false;
        }

        if self.seen_notifications.len() >= MAX_DEDUP_ENTRIES {
            if let Some(oldest_key) = self
                .seen_notifications
                .iter()
                .min_by_key(|(_, seen)| seen.seen_at)
                .map(|(key, _)| key.clone())
            {
                self.seen_notifications.remove(&oldest_key);
            }
        }
        self.seen_notifications.insert(
            key,
            SeenNotification {
                seen_at: now,
                content,
            },
        );
        true
    }
}

fn notification_id_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) if !value.trim().is_empty() => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn parse_config(contents: &str) -> Option<FilterConfig> {
    serde_json::from_str(contents).ok()
}

#[cfg(test)]
mod tests {
    use super::{parse_config, FilterConfig, NotificationFilter};
    use crate::bus::Event;
    use serde_json::json;

    fn event(source: &str, app: Option<&str>, notification_id: Option<&str>) -> Event {
        let mut meta = serde_json::Map::new();
        if let Some(app) = app {
            meta.insert("app".into(), json!(app));
        }
        if let Some(notification_id) = notification_id {
            meta.insert("notificationId".into(), json!(notification_id));
        }
        Event {
            id: "550e8400-e29b-41d4-a716-446655440000".into(),
            source: source.into(),
            kind: if source == "chat" { "message" } else { "task" }.into(),
            status: Some(
                if source == "chat" {
                    "unread"
                } else {
                    "running"
                }
                .into(),
            ),
            title: "Notification title".into(),
            body: Some("Sensitive message body".into()),
            progress: None,
            started_at: None,
            meta: Some(meta.into()),
        }
    }

    #[test]
    fn parses_valid_unknown_and_malformed_config_fixtures() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../fixtures/notification-filter.json"))
                .expect("notification filter fixture is valid JSON");
        let valid = parse_config(&fixture["valid"].to_string()).expect("valid filter config");
        let unknown = parse_config(&fixture["unknownFields"].to_string())
            .expect("unknown fields are ignored");

        assert_eq!(valid.monitored_apps, vec!["WhatsApp", "Telegram"]);
        assert_eq!(unknown.monitored_apps, vec!["WhatsApp"]);
        assert!(parse_config(&fixture["malformed"].to_string()).is_none());
    }

    #[test]
    fn app_filter_matches_case_insensitively_and_fails_closed_for_missing_app() {
        let mut filter = NotificationFilter::from_config(FilterConfig {
            monitored_apps: vec!["WhatsApp".into()],
        });

        assert!(filter.should_forward(&event("chat", Some("whatsapp"), Some("10"))));
        assert!(!filter.should_forward(&event("chat", Some("Telegram"), Some("11"))));
        assert!(!filter.should_forward(&event("chat", None, Some("12"))));
        assert!(filter.should_forward(&event("codex", None, None)));
    }

    #[test]
    fn default_filter_allows_whatsapp_and_ignores_other_app_toasts() {
        let mut filter = NotificationFilter::from_config(FilterConfig::default());

        assert!(filter.should_forward(&event("chat", Some("WhatsApp"), Some("1"))));
        assert!(!filter.should_forward(&event("chat", Some("Codex"), Some("2"))));
    }

    #[test]
    fn duplicate_notification_ids_from_the_same_app_are_suppressed() {
        let mut filter = NotificationFilter::from_config(FilterConfig {
            monitored_apps: vec!["WhatsApp".into(), "Telegram".into()],
        });

        assert!(filter.should_forward(&event("chat", Some("WhatsApp"), Some("42"))));
        assert!(!filter.should_forward(&event("chat", Some("whatsapp"), Some("42"))));
        assert!(filter.should_forward(&event("chat", Some("WhatsApp"), Some("43"))));
        assert!(filter.should_forward(&event("chat", Some("Telegram"), Some("42"))));
        assert!(filter.should_forward(&event("chat", Some("WhatsApp"), None)));
    }

    #[test]
    fn updated_notification_with_same_id_is_forwarded_when_content_changes() {
        let mut filter = NotificationFilter::from_config(FilterConfig::default());
        let original = event("chat", Some("WhatsApp"), Some("42"));
        let mut updated = event("chat", Some("WhatsApp"), Some("42"));
        updated.body = Some("A newer WhatsApp message".into());

        assert!(filter.should_forward(&original));
        assert!(filter.should_forward(&updated));
        assert!(!filter.should_forward(&updated));
    }

    #[test]
    fn filter_reload_applies_updated_app_selection() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock is after the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("dot-notifier-filter-{unique}.json"));
        std::fs::write(&path, r#"{"monitoredApps":["WhatsApp"]}"#)
            .expect("initial filter can be written");
        let mut filter = NotificationFilter::load(&path);
        assert!(filter.should_forward(&event("chat", Some("WhatsApp"), Some("1"))));
        assert!(!filter.should_forward(&event("chat", Some("Telegram"), Some("2"))));

        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&path, r#"{"monitoredApps":["Telegram"]}"#)
            .expect("updated filter can be written");
        assert!(!filter.should_forward(&event("chat", Some("WhatsApp"), Some("3"))));
        assert!(filter.should_forward(&event("chat", Some("Telegram"), Some("4"))));
        std::fs::remove_file(path).expect("temporary filter can be removed");
    }
}
