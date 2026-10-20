const CLIPBOARD_UNICODE_TEXT: u32 = 13;
const MAX_CLIPBOARD_UNITS: usize = 8_192;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSnapshot {
    sequence: u32,
    text: Option<String>,
}

#[cfg(windows)]
pub fn read_snapshot(last_sequence: Option<u32>) -> Result<Option<ClipboardSnapshot>, String> {
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

    let sequence = unsafe { GetClipboardSequenceNumber() };
    if sequence == 0 || last_sequence == Some(sequence) {
        return Ok(None);
    }
    Ok(Some(ClipboardSnapshot {
        sequence,
        text: read_current_text()?,
    }))
}

#[cfg(not(windows))]
pub fn read_snapshot(_last_sequence: Option<u32>) -> Result<Option<ClipboardSnapshot>, String> {
    Err("Clipboard history is available on Windows only".into())
}

fn decode_clipboard_text(units: &[u16]) -> String {
    let preview = units.iter().take(MAX_CLIPBOARD_UNITS);
    let length = preview
        .clone()
        .position(|unit| *unit == 0)
        .unwrap_or(preview.len());
    String::from_utf16_lossy(&units[..length])
}

#[cfg(windows)]
pub fn read_current_text() -> Result<Option<String>, String> {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            let _ = unsafe { CloseClipboard() };
        }
    }

    struct GlobalLockGuard(HGLOBAL);
    impl Drop for GlobalLockGuard {
        fn drop(&mut self) {
            let _ = unsafe { GlobalUnlock(self.0) };
        }
    }

    unsafe { OpenClipboard(None) }.map_err(|error| format!("Could not open clipboard: {error}"))?;
    let _clipboard = ClipboardGuard;
    if unsafe { IsClipboardFormatAvailable(CLIPBOARD_UNICODE_TEXT) }.is_err() {
        return Ok(None);
    }

    let data = unsafe { GetClipboardData(CLIPBOARD_UNICODE_TEXT) }
        .map_err(|error| format!("Could not read clipboard text: {error}"))?;
    let memory = HGLOBAL(data.0);
    let size_bytes = unsafe { GlobalSize(memory) };
    let unit_count = (size_bytes / std::mem::size_of::<u16>()).min(MAX_CLIPBOARD_UNITS);
    if unit_count == 0 {
        return Ok(None);
    }

    let locked = unsafe { GlobalLock(memory) };
    if locked.is_null() {
        return Err("Could not lock clipboard text".into());
    }
    let _lock = GlobalLockGuard(memory);
    let units = unsafe { std::slice::from_raw_parts(locked.cast::<u16>(), unit_count) };
    let text = decode_clipboard_text(units);
    Ok((!text.is_empty()).then_some(text))
}

#[cfg(not(windows))]
pub fn read_current_text() -> Result<Option<String>, String> {
    Err("Clipboard preview is available on Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::{decode_clipboard_text, MAX_CLIPBOARD_UNITS};

    #[test]
    fn decodes_text_until_the_clipboard_terminator() {
        assert_eq!(decode_clipboard_text(&[72, 105, 0, 88]), "Hi");
    }

    #[test]
    fn bounds_the_preview_size() {
        let text = vec![65; MAX_CLIPBOARD_UNITS + 3];
        assert_eq!(decode_clipboard_text(&text).len(), MAX_CLIPBOARD_UNITS);
    }
}
