use std::path::Path;
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::bus::Event;
use crate::notification_filter::NotificationFilter;

const POLL_INTERVAL: Duration = Duration::from_millis(1500);

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawNotification {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub body: Option<String>,
    pub created_at: Option<String>,
}

pub fn start(app: AppHandle) {
    if let Err(error) = thread::Builder::new()
        .name("dot-notifier-win-notifications".into())
        .spawn(move || poll_notifications(app))
    {
        eprintln!("Could not start Windows notification adapter: {error}");
    }
}

fn poll_notifications(app: AppHandle) {
    #[cfg(windows)]
    {
        use windows::UI::Notifications::Management::{
            UserNotificationListener, UserNotificationListenerAccessStatus,
        };
        use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds};

        let filter_path = app
            .path()
            .app_local_data_dir()
            .map(|directory| directory.join("notification-filter.json"))
            .ok();

        let mut filter = filter_path
            .as_deref()
            .map(NotificationFilter::load)
            .unwrap_or_else(|| NotificationFilter::load(Path::new("")));

        loop {
            thread::sleep(POLL_INTERVAL);

            let Ok(listener) = UserNotificationListener::Current() else {
                continue;
            };

            let access_status = listener
                .GetAccessStatus()
                .unwrap_or(UserNotificationListenerAccessStatus::Unspecified);
            if access_status != UserNotificationListenerAccessStatus::Allowed {
                continue;
            }

            let Ok(notifications_op) = listener.GetNotificationsAsync(NotificationKinds::Toast)
            else {
                continue;
            };
            let Ok(notifications) = notifications_op.join() else {
                continue;
            };

            for item in notifications {
                let id = match item.Id() {
                    Ok(id) => id,
                    Err(_) => continue,
                };

                let app_name = item
                    .AppInfo()
                    .ok()
                    .and_then(|info| info.DisplayInfo().ok())
                    .and_then(|display| display.DisplayName().ok())
                    .map(|h| h.to_string())
                    .unwrap_or_else(|| "Unknown".into());

                let mut title = app_name.clone();
                let mut body = None;

                if let Ok(binding_id) = KnownNotificationBindings::ToastGeneric() {
                    if let Ok(binding) = item
                        .Notification()
                        .and_then(|n| n.Visual())
                        .and_then(|v| v.GetBinding(&binding_id))
                    {
                        if let Ok(text_elements) = binding.GetTextElements() {
                            let mut texts = Vec::new();
                            for text_elem in text_elements {
                                if let Ok(hstring) = text_elem.Text() {
                                    let s = hstring.to_string();
                                    if !s.trim().is_empty() {
                                        texts.push(s);
                                    }
                                }
                            }
                            if let Some(first) = texts.first() {
                                title = first.clone();
                            }
                            if texts.len() > 1 {
                                body = Some(texts[1..].join(" "));
                            }
                        }
                    }
                }

                let raw = RawNotification {
                    id,
                    app_name,
                    title,
                    body,
                    created_at: None,
                };

                if let Some(event) = event_from_raw(&raw) {
                    if filter.should_forward(&event) {
                        if let Err(error) = app.emit("bus-event", event) {
                            eprintln!("Could not deliver notification to UI: {error}");
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

pub fn event_from_raw(raw: &RawNotification) -> Option<Event> {
    if raw.app_name.trim().is_empty() {
        return None;
    }

    let uuid = deterministic_uuid(raw.id, &raw.app_name);
    let title = if raw.title.trim().is_empty() {
        raw.app_name.clone()
    } else {
        raw.title.clone()
    };

    Some(Event {
        id: uuid,
        source: "chat".into(),
        kind: "message".into(),
        status: Some("unread".into()),
        title,
        body: raw.body.clone(),
        progress: None,
        started_at: raw.created_at.clone(),
        meta: Some(serde_json::json!({
            "app": raw.app_name,
            "sender": raw.title,
            "notificationId": raw.id.to_string(),
        })),
    })
}

pub fn check_permission() -> bool {
    #[cfg(windows)]
    {
        use windows::UI::Notifications::Management::{
            UserNotificationListener, UserNotificationListenerAccessStatus,
        };
        UserNotificationListener::Current()
            .ok()
            .and_then(|l| l.GetAccessStatus().ok())
            .map(|s| s == UserNotificationListenerAccessStatus::Allowed)
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn request_permission() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use windows::UI::Notifications::Management::{
            UserNotificationListener, UserNotificationListenerAccessStatus,
        };
        let listener = UserNotificationListener::Current().map_err(|e| e.to_string())?;
        let status = listener
            .GetAccessStatus()
            .unwrap_or(UserNotificationListenerAccessStatus::Unspecified);
        if status == UserNotificationListenerAccessStatus::Allowed {
            return Ok(true);
        }
        let op = listener.RequestAccessAsync().map_err(|e| e.to_string())?;
        let result = op.join().map_err(|e| e.to_string())?;
        Ok(result == UserNotificationListenerAccessStatus::Allowed)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

fn deterministic_uuid(notification_id: u32, app_name: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in app_name.as_bytes() {
        hash = (hash ^ (*byte as u64)).wrapping_mul(0x100000001b3);
    }
    hash = (hash ^ (notification_id as u64)).wrapping_mul(0x100000001b3);

    let high = hash;
    let low = hash
        .wrapping_mul(0x517cc1b727220a95)
        .wrapping_add(notification_id as u64);

    format!(
        "{:08x}-{:04x}-4{:03x}-a{:03x}-{:012x}",
        (high >> 32) as u32,
        (high >> 16) as u16,
        (high & 0x0fff) as u16,
        (low >> 48 & 0x0fff) as u16,
        low & 0x0000_ffff_ffff_ffff
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_raw_notification_into_chat_event() {
        let raw = RawNotification {
            id: 12345,
            app_name: "WhatsApp".into(),
            title: "Alice".into(),
            body: Some("Hey there".into()),
            created_at: None,
        };

        let event = event_from_raw(&raw).expect("valid event");
        assert_eq!(event.source, "chat");
        assert_eq!(event.kind, "message");
        assert_eq!(event.status.as_deref(), Some("unread"));
        assert_eq!(event.title, "Alice");
        assert_eq!(event.body.as_deref(), Some("Hey there"));
        assert_eq!(event.id.len(), 36);
        let meta = event.meta.unwrap();
        assert_eq!(meta.get("app").unwrap().as_str().unwrap(), "WhatsApp");
        assert_eq!(meta.get("sender").unwrap().as_str().unwrap(), "Alice");
    }

    #[test]
    fn rejects_raw_notification_with_empty_app_name() {
        let raw = RawNotification {
            id: 12345,
            app_name: "   ".into(),
            title: "Test".into(),
            body: None,
            created_at: None,
        };
        assert!(event_from_raw(&raw).is_none());
    }

    #[test]
    fn deterministic_uuid_produces_valid_conforming_uuids() {
        let id1 = deterministic_uuid(100, "WhatsApp");
        let id2 = deterministic_uuid(100, "WhatsApp");
        let id3 = deterministic_uuid(101, "WhatsApp");
        assert_eq!(id1, id2);
        assert_ne!(id1, id3);
        assert_eq!(id1.len(), 36);

        let bytes = id1.as_bytes();
        assert_eq!(bytes[8], b'-');
        assert_eq!(bytes[13], b'-');
        assert_eq!(bytes[18], b'-');
        assert_eq!(bytes[23], b'-');
    }

    #[test]
    fn parses_valid_unknown_and_malformed_notification_fixtures() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../fixtures/win-notification.json"))
                .expect("notification fixture is valid JSON");

        let valid: Result<RawNotification, _> = serde_json::from_value(fixture["valid"].clone());
        assert!(valid.is_ok());
        let event = event_from_raw(&valid.unwrap());
        assert!(event.is_some());

        let unknown: Result<RawNotification, _> =
            serde_json::from_value(fixture["unknownFields"].clone());
        assert!(unknown.is_ok());
        let event = event_from_raw(&unknown.unwrap());
        assert!(event.is_some());

        let malformed: Result<RawNotification, _> =
            serde_json::from_value(fixture["malformed"].clone());
        assert!(malformed.is_err() || malformed.ok().and_then(|r| event_from_raw(&r)).is_none());
    }
}
