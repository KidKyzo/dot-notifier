#[cfg(any(windows, test))]
fn source_executable(source_app_id: &str) -> Option<&'static str> {
    let source = source_app_id
        .to_ascii_lowercase()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>();
    if source.contains("spotify") {
        Some("spotify.exe")
    } else if source.contains("applemusic") {
        Some("applemusic.exe")
    } else if source.contains("youtubemusic") {
        Some("youtubemusic.exe")
    } else if source.contains("msedge") || source.contains("microsoftedge") {
        Some("msedge.exe")
    } else if source.contains("chrome") {
        Some("chrome.exe")
    } else {
        None
    }
}

#[cfg(windows)]
fn process_images() -> Result<std::collections::HashMap<u32, String>, String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|error| error.to_string())?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut images = std::collections::HashMap::new();
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            images.insert(
                entry.th32ProcessID,
                String::from_utf16_lossy(&entry.szExeFile)
                    .trim_end_matches('\0')
                    .to_ascii_lowercase(),
            );
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    unsafe { CloseHandle(snapshot) }.map_err(|error| error.to_string())?;
    Ok(images)
}

#[cfg(windows)]
fn with_music_volume<T>(
    allow_browser_media: bool,
    action: impl FnOnce(windows::Win32::Media::Audio::ISimpleAudioVolume) -> Result<T, String>,
) -> Result<Option<T>, String> {
    use windows::core::Interface;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager as MediaManager;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    let media_manager = MediaManager::RequestAsync()
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    let Some(media_session) =
        crate::media_controls::supported_music_session(&media_manager, allow_browser_media)
    else {
        return Ok(None);
    };
    let app_id = media_session
        .SourceAppUserModelId()
        .map_err(|error| error.to_string())?
        .to_string();
    let Some(executable) = source_executable(&app_id) else {
        return Ok(None);
    };
    let images = process_images()?;

    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|error| error.to_string())?;
    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    let _com = ComGuard;

    let devices: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|error| error.to_string())?;
    let device = unsafe { devices.GetDefaultAudioEndpoint(eRender, eMultimedia) }
        .map_err(|error| error.to_string())?;
    let manager: IAudioSessionManager2 =
        unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(|error| error.to_string())?;
    let sessions = unsafe { manager.GetSessionEnumerator() }.map_err(|error| error.to_string())?;
    let count = unsafe { sessions.GetCount() }.map_err(|error| error.to_string())?;
    let mut matches = Vec::new();
    for index in 0..count {
        let control = unsafe { sessions.GetSession(index) }.map_err(|error| error.to_string())?;
        let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
            continue;
        };
        let Ok(pid) = (unsafe { control2.GetProcessId() }) else {
            continue;
        };
        if images.get(&pid).is_some_and(|image| image == executable) {
            if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                matches.push(volume);
            }
        }
    }
    if matches.len() != 1 {
        return Ok(None);
    }
    action(matches.remove(0)).map(Some)
}

#[cfg(windows)]
pub fn current(allow_browser_media: bool) -> Result<Option<u8>, String> {
    with_music_volume(allow_browser_media, |volume| {
        let level = unsafe { volume.GetMasterVolume() }.map_err(|error| error.to_string())?;
        Ok((level * 100.0).round().clamp(0.0, 100.0) as u8)
    })
}

#[cfg(not(windows))]
pub fn current(_allow_browser_media: bool) -> Result<Option<u8>, String> {
    Ok(None)
}

#[cfg(windows)]
pub fn set(level: u8, allow_browser_media: bool) -> Result<Option<u8>, String> {
    if level > 100 {
        return Err("Volume must be between 0 and 100".into());
    }
    with_music_volume(allow_browser_media, |volume| {
        unsafe { volume.SetMasterVolume(f32::from(level) / 100.0, std::ptr::null()) }
            .map_err(|error| error.to_string())?;
        Ok(level)
    })
}

#[cfg(not(windows))]
pub fn set(_level: u8, _allow_browser_media: bool) -> Result<Option<u8>, String> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::source_executable;

    #[test]
    fn maps_only_supported_media_sources_to_audio_apps() {
        assert_eq!(
            source_executable("SpotifyAB.SpotifyMusic!Spotify"),
            Some("spotify.exe")
        );
        assert_eq!(source_executable("MSEdge.exe"), Some("msedge.exe"));
        assert_eq!(source_executable("other.exe"), None);
    }
}
