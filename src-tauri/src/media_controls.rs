use std::sync::{Mutex, OnceLock};

use serde::Serialize;

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MediaAction {
    Play,
    Pause,
    Previous,
    Next,
}

#[cfg(any(windows, test))]
impl MediaAction {
    fn parse(action: &str) -> Option<Self> {
        match action {
            "play" => Some(Self::Play),
            "pause" => Some(Self::Pause),
            "previous" => Some(Self::Previous),
            "next" => Some(Self::Next),
            _ => None,
        }
    }
}

fn is_supported_music_source(app_user_model_id: &str, allow_browser_media: bool) -> bool {
    let source = app_user_model_id
        .to_ascii_lowercase()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>();
    [
        "spotify",
        "applemusic",
        "youtubemusic",
        "youtube-music",
        "youtube_music",
    ]
    .iter()
    .any(|name| source.contains(name))
        || (allow_browser_media
            && ["chrome", "msedge", "microsoftedge"]
                .iter()
                .any(|name| source.contains(name)))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub playing: bool,
    pub position_seconds: u64,
    pub cover_data_url: Option<String>,
}

#[cfg(windows)]
pub fn current(allow_browser_media: bool) -> Option<NowPlaying> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };

    let manager = Manager::RequestAsync().ok()?.join().ok()?;
    let session = supported_music_session(&manager, allow_browser_media)?;
    let properties = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let title = properties.Title().ok()?.to_string();
    if title.trim().is_empty() {
        return None;
    }
    let artist = properties.Artist().ok()?.to_string();
    let playing = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .is_some_and(|status| status == PlaybackStatus::Playing);
    let position_seconds = session
        .GetTimelineProperties()
        .ok()
        .and_then(|timeline| timeline.Position().ok())
        .map(|position| (position.Duration / 10_000_000).max(0) as u64)
        .unwrap_or_default();
    static LAST_TRACK: OnceLock<Mutex<Option<NowPlaying>>> = OnceLock::new();
    let cache = LAST_TRACK.get_or_init(|| Mutex::new(None));
    if let Ok(last_track) = cache.lock() {
        if let Some(previous) = last_track
            .as_ref()
            .filter(|previous| previous.title == title && previous.artist == artist)
        {
            return Some(NowPlaying {
                playing,
                position_seconds,
                ..previous.clone()
            });
        }
    }
    let cover_data_url = properties.Thumbnail().ok().and_then(|thumbnail| {
        let stream = thumbnail.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 512 * 1024 {
            return None;
        }
        let content_type = stream.ContentType().ok()?.to_string();
        if !matches!(
            content_type.as_str(),
            "image/jpeg" | "image/png" | "image/webp"
        ) {
            return None;
        }
        let reader = windows::Storage::Streams::DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size as u32).ok()?.join().ok()?;
        let mut bytes = vec![0; size as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(format!("data:{content_type};base64,{}", base64(&bytes)))
    });

    let snapshot = NowPlaying {
        title,
        artist,
        playing,
        position_seconds,
        cover_data_url,
    };
    if let Ok(mut last_track) = cache.lock() {
        *last_track = Some(snapshot.clone());
    }
    Some(snapshot)
}

#[cfg(not(windows))]
pub fn current(_allow_browser_media: bool) -> Option<NowPlaying> {
    None
}

#[cfg(windows)]
pub fn control(action: &str, allow_browser_media: bool) -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager as Manager;

    let manager = Manager::RequestAsync()
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    let session = supported_music_session(&manager, allow_browser_media)
        .ok_or_else(|| "No supported music app is available".to_owned())?;
    let media_action =
        MediaAction::parse(action).ok_or_else(|| "Unknown media action".to_owned())?;
    let operation = match media_action {
        MediaAction::Play => session.TryPlayAsync(),
        MediaAction::Pause => session.TryPauseAsync(),
        MediaAction::Previous => session.TrySkipPreviousAsync(),
        MediaAction::Next => session.TrySkipNextAsync(),
    }
    .map_err(|error| error.to_string())?;
    operation
        .join()
        .map_err(|error| error.to_string())?
        .then_some(())
        .ok_or_else(|| "The media session did not accept the command".into())
}

#[cfg(windows)]
fn supported_music_session(
    manager: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
    allow_browser_media: bool,
) -> Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSession as Session;
    let is_supported = |session: &Session| {
        session.SourceAppUserModelId().ok().is_some_and(|source| {
            is_supported_music_source(&source.to_string(), allow_browser_media)
        })
    };
    if let Ok(current) = manager.GetCurrentSession() {
        if is_supported(&current) {
            return Some(current);
        }
    }

    let sessions = manager.GetSessions().ok()?;
    let count = sessions.Size().ok()?;
    let mut paused_session = None;
    for index in 0..count {
        let Ok(session) = sessions.GetAt(index) else {
            continue;
        };
        if !is_supported(&session) {
            continue;
        }
        if session
            .GetPlaybackInfo()
            .ok()
            .and_then(|info| info.PlaybackStatus().ok())
            .is_some_and(|status| {
                status
                    == windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
            })
        {
            return Some(session);
        }
        if paused_session.is_none() {
            paused_session = Some(session);
        }
    }
    paused_session
}

#[cfg(not(windows))]
pub fn control(_action: &str, _allow_browser_media: bool) -> Result<(), String> {
    Err("Media controls are available on Windows only".into())
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        output.push(TABLE[(first >> 2) as usize] as char);
        output.push(TABLE[(((first & 0b11) << 4) | (second >> 4)) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[(((second & 0b1111) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(third & 0b0011_1111) as usize] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{base64, MediaAction};

    #[test]
    fn parses_supported_playback_actions() {
        assert_eq!(MediaAction::parse("play"), Some(MediaAction::Play));
        assert_eq!(MediaAction::parse("pause"), Some(MediaAction::Pause));
        assert_eq!(MediaAction::parse("previous"), Some(MediaAction::Previous));
        assert_eq!(MediaAction::parse("next"), Some(MediaAction::Next));
        assert_eq!(MediaAction::parse("stop"), None);
    }

    #[test]
    fn encodes_thumbnail_bytes_as_base64() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
    }
}
