use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::bus::Event;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const DISCOVERY_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const ACTIVE_AGE: Duration = Duration::from_secs(3 * 60);
const INITIAL_TAIL_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TaskState {
    Running,
    Done,
    Error,
}

struct WatchedFile {
    length: u64,
    conversation_id: String,
    agent: &'static str,
}

#[derive(Deserialize)]
struct TranscriptLine {
    #[serde(rename = "type")]
    record_type: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Deserialize)]
struct ToolCall {
    name: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct LogUpdate {
    state: TaskState,
    title: String,
    started_at: Option<String>,
}

pub fn start(app: AppHandle) {
    if let Err(error) = thread::Builder::new()
        .name("dot-notifier-antigravity-logs".into())
        .spawn(move || watch_sessions(app))
    {
        eprintln!("Could not start Antigravity log adapter: {error}");
    }
}

fn watch_sessions(app: AppHandle) {
    let mut watched = HashMap::<PathBuf, WatchedFile>::new();
    thread::sleep(POLL_INTERVAL);
    loop {
        for (agent, root) in brain_directories() {
            for path in recent_transcripts(&root) {
                let metadata = match fs::metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };
                let length = metadata.len();

                if let Some(file_state) = watched.get_mut(&path) {
                    if length < file_state.length {
                        file_state.length = length;
                    }
                    if length > file_state.length {
                        let (updates, consumed) =
                            read_updates(&path, file_state.length, length, file_state.agent);
                        file_state.length = consumed;
                        for update in updates {
                            emit_task(&app, file_state.agent, &file_state.conversation_id, update);
                        }
                    }
                    continue;
                }

                let Some(conversation_id) = conversation_id_from_path(&path) else {
                    continue;
                };
                let initial_offset = length.saturating_sub(INITIAL_TAIL_BYTES);
                let (updates, _) = read_updates(&path, initial_offset, length, agent);
                if let Some(latest) = updates.last() {
                    if latest.state == TaskState::Running
                        && (latest
                            .started_at
                            .as_deref()
                            .is_some_and(|timestamp| timestamp_is_recent(timestamp, ACTIVE_AGE))
                            || metadata
                                .modified()
                                .ok()
                                .and_then(|time| SystemTime::now().duration_since(time).ok())
                                .is_some_and(|age| age <= ACTIVE_AGE))
                    {
                        emit_task(
                            &app,
                            agent,
                            &conversation_id,
                            LogUpdate {
                                state: TaskState::Running,
                                title: latest.title.clone(),
                                started_at: updates.iter().rev().find_map(|update| {
                                    (update.state == TaskState::Running)
                                        .then(|| update.started_at.clone())
                                        .flatten()
                                }),
                            },
                        );
                    }
                }
                watched.insert(
                    path,
                    WatchedFile {
                        length,
                        conversation_id,
                        agent,
                    },
                );
            }
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn brain_directories() -> Vec<(&'static str, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let app_dir = PathBuf::from(&home)
            .join(".gemini")
            .join("antigravity")
            .join("brain");
        if app_dir.is_dir() {
            roots.push(("antigravity-app", app_dir));
        }
        let ide_dir = PathBuf::from(&home)
            .join(".gemini")
            .join("antigravity-ide")
            .join("brain");
        if ide_dir.is_dir() {
            roots.push(("antigravity-ide", ide_dir));
        }
        let cli_dir = PathBuf::from(&home)
            .join(".gemini")
            .join("antigravity-cli")
            .join("brain");
        if cli_dir.is_dir() {
            roots.push(("antigravity-cli", cli_dir));
        }
    }
    roots
}

fn recent_transcripts(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().is_ok_and(|ft| ft.is_dir()) {
            continue;
        }
        let transcript = path
            .join(".system_generated")
            .join("logs")
            .join("transcript.jsonl");
        let Ok(metadata) = fs::metadata(&transcript) else {
            continue;
        };
        if metadata
            .modified()
            .ok()
            .and_then(|time| SystemTime::now().duration_since(time).ok())
            .is_some_and(|age| age <= DISCOVERY_AGE)
        {
            found.push(transcript);
        }
    }
    found
}

fn conversation_id_from_path(path: &Path) -> Option<String> {
    let conversation_dir = path.parent()?.parent()?.parent()?;
    let name = conversation_dir.file_name()?.to_string_lossy();
    is_uuid(&name).then(|| name.to_ascii_lowercase())
}

fn read_updates(path: &Path, offset: u64, length: u64, agent: &str) -> (Vec<LogUpdate>, u64) {
    let Ok(mut file) = File::open(path) else {
        return (Vec::new(), offset);
    };
    if file.seek(SeekFrom::Start(offset)).is_err() {
        return (Vec::new(), offset);
    }
    let to_read = length.saturating_sub(offset) as usize;
    let mut bytes = Vec::with_capacity(to_read);
    if file.take(to_read as u64).read_to_end(&mut bytes).is_err() {
        return (Vec::new(), offset);
    }
    if bytes.is_empty() {
        return (Vec::new(), offset);
    }
    let consumed = if let Some(last_newline) = bytes.iter().rposition(|&b| b == b'\n') {
        offset + (last_newline as u64) + 1
    } else {
        offset
    };
    let slice_to_parse = if consumed > offset {
        &bytes[..(consumed - offset) as usize]
    } else {
        &bytes[..]
    };
    let text = String::from_utf8_lossy(slice_to_parse);
    let mut updates = Vec::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        if let Some(update) = parse_transcript_line(line, agent) {
            updates.push(update);
        }
    }
    (updates, if consumed > offset { consumed } else { length })
}

fn agent_label(agent: &str) -> &'static str {
    match agent {
        "antigravity-cli" => "CLI",
        "antigravity-app" => "App",
        _ => "IDE",
    }
}

fn parse_transcript_line(line: &str, agent: &str) -> Option<LogUpdate> {
    let record: TranscriptLine = serde_json::from_str(line).ok()?;
    let record_type = record.record_type.as_deref()?;
    let agent_name = agent_label(agent);

    if record.status.as_deref() == Some("ERROR") {
        return Some(LogUpdate {
            state: TaskState::Error,
            title: format!("Antigravity {agent_name} task failed"),
            started_at: None,
        });
    }

    match record_type {
        "USER_INPUT" => Some(LogUpdate {
            state: TaskState::Running,
            title: "Starting task".into(),
            started_at: record.created_at,
        }),
        "CHECKPOINT" => Some(LogUpdate {
            state: TaskState::Done,
            title: format!("Antigravity {agent_name} task completed"),
            started_at: None,
        }),
        "PLANNER_RESPONSE" => {
            let has_tools = record
                .tool_calls
                .as_ref()
                .is_some_and(|calls| !calls.is_empty());
            if has_tools {
                let activity = record
                    .tool_calls
                    .as_ref()
                    .and_then(|calls| calls.last())
                    .and_then(|call| call.name.as_deref())
                    .map(tool_activity)
                    .unwrap_or("Using tools");
                Some(LogUpdate {
                    state: TaskState::Running,
                    title: activity.into(),
                    started_at: None,
                })
            } else {
                Some(LogUpdate {
                    state: TaskState::Done,
                    title: format!("Antigravity {agent_name} task completed"),
                    started_at: None,
                })
            }
        }
        "RUN_COMMAND"
        | "CODE_ACTION"
        | "WRITE_TO_FILE"
        | "REPLACE_FILE_CONTENT"
        | "VIEW_FILE"
        | "GREP_SEARCH"
        | "LIST_DIR"
        | "LIST_DIRECTORY"
        | "CALL_MCP_TOOL"
        | "BROWSER_SUBAGENT"
        | "GENERATE_IMAGE" => Some(LogUpdate {
            state: TaskState::Running,
            title: match record_type {
                "RUN_COMMAND" => "Running a command",
                "CODE_ACTION" | "WRITE_TO_FILE" | "REPLACE_FILE_CONTENT" => "Editing code",
                "VIEW_FILE" | "LIST_DIR" | "LIST_DIRECTORY" => "Reading files",
                "GREP_SEARCH" => "Searching files",
                "BROWSER_SUBAGENT" => "Browsing",
                "GENERATE_IMAGE" => "Creating an image",
                _ => "Using tools",
            }
            .into(),
            started_at: None,
        }),
        _ => None,
    }
}

fn tool_activity(name: &str) -> &'static str {
    match name {
        "run_command" => "Running a command",
        "write_to_file" | "replace_file_content" => "Editing code",
        "view_file" | "list_dir" => "Reading files",
        "grep_search" => "Searching files",
        "browser_subagent" => "Browsing",
        "generate_image" => "Creating an image",
        _ => "Using tools",
    }
}

fn emit_task(app: &AppHandle, agent: &str, conversation_id: &str, update: LogUpdate) {
    let status = match update.state {
        TaskState::Running => "running",
        TaskState::Done => "done",
        TaskState::Error => "error",
    };
    let event = Event {
        id: conversation_id.to_owned(),
        source: "ai".into(),
        agent: Some(agent.into()),
        session_id: Some(conversation_id.to_owned()),
        kind: "task".into(),
        status: Some(status.into()),
        title: update.title,
        body: None,
        progress: None,
        started_at: update.started_at,
        cwd: None,
        pid: None,
        usage: None,
        actions: None,
        action_nonce: None,
        meta: None,
    };
    if let Err(error) = app.emit("bus-event", event) {
        eprintln!("Could not deliver Antigravity log update to UI: {error}");
    }
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
}

fn timestamp_is_recent(timestamp: &str, max_age: Duration) -> bool {
    let Some((date, time_and_zone)) = timestamp.split_once('T') else {
        return false;
    };
    let mut date_parts = date.split('-');
    let (Some(Ok(year)), Some(Ok(month)), Some(Ok(day)), None) = (
        date_parts.next().map(str::parse::<i64>),
        date_parts.next().map(str::parse::<i64>),
        date_parts.next().map(str::parse::<i64>),
        date_parts.next(),
    ) else {
        return false;
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return false;
    }

    let zone_start = time_and_zone
        .find(['Z', '+', '-'])
        .unwrap_or(time_and_zone.len());
    let time = &time_and_zone[..zone_start];
    let mut time_parts = time.split(':');
    let (Some(Ok(hour)), Some(Ok(minute)), Some(second_text), None) = (
        time_parts.next().map(str::parse::<i64>),
        time_parts.next().map(str::parse::<i64>),
        time_parts.next(),
        time_parts.next(),
    ) else {
        return false;
    };
    let second = second_text
        .split('.')
        .next()
        .and_then(|part| part.parse::<i64>().ok());
    let (Some(second), true) = (
        second,
        (0..=23).contains(&hour) && (0..=59).contains(&minute),
    ) else {
        return false;
    };
    if !(0..=60).contains(&second) {
        return false;
    }

    let zone = &time_and_zone[zone_start..];
    let offset_seconds = if zone.is_empty() || zone == "Z" {
        0
    } else {
        let sign = match zone.as_bytes().first() {
            Some(b'+') => 1,
            Some(b'-') => -1,
            _ => return false,
        };
        let mut offset_parts = zone[1..].split(':');
        let (Some(Ok(offset_hour)), Some(Ok(offset_minute)), None) = (
            offset_parts.next().map(str::parse::<i64>),
            offset_parts.next().map(str::parse::<i64>),
            offset_parts.next(),
        ) else {
            return false;
        };
        if !(0..=23).contains(&offset_hour) || !(0..=59).contains(&offset_minute) {
            return false;
        }
        sign * (offset_hour * 3600 + offset_minute * 60)
    };

    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days_since_epoch = era * 146_097 + day_of_era - 719_468;
    let unix_seconds =
        days_since_epoch * 86_400 + hour * 3600 + minute * 60 + second - offset_seconds;
    let Ok(unix_seconds) = u64::try_from(unix_seconds) else {
        return false;
    };
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .is_some_and(|now| {
            now.as_secs().saturating_sub(unix_seconds) <= max_age.as_secs()
                && unix_seconds <= now.as_secs()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_user_input_as_running() {
        let line = r#"{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-10-12T05:40:48Z"}"#;
        let update = parse_transcript_line(line, "antigravity-ide").expect("parsed update");
        assert_eq!(update.state, TaskState::Running);
        assert_eq!(update.title, "Starting task");
        assert_eq!(update.started_at.as_deref(), Some("2026-10-12T05:40:48Z"));
    }

    #[test]
    fn parses_antigravity_app_status_separately_from_ide() {
        let line = r#"{"type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[]}"#;
        let update = parse_transcript_line(line, "antigravity-app").expect("parsed update");
        assert_eq!(update.state, TaskState::Done);
        assert_eq!(update.title, "Antigravity App task completed");
    }

    #[test]
    fn parses_planner_response_with_tools_as_running() {
        let line = r#"{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-10-12T05:40:50Z","tool_calls":[{"name":"view_file"}]}"#;
        let update = parse_transcript_line(line, "antigravity-ide").expect("parsed update");
        assert_eq!(update.state, TaskState::Running);
        assert_eq!(update.title, "Reading files");
    }

    #[test]
    fn classifies_tool_records_without_exposing_content() {
        let read = r#"{"type":"VIEW_FILE","status":"DONE","path":"private/file.txt"}"#;
        let edit = r#"{"type":"REPLACE_FILE_CONTENT","status":"DONE","content":"private text"}"#;
        let code_action = r#"{"type":"CODE_ACTION","status":"DONE","content":"private text"}"#;
        let list = r#"{"type":"LIST_DIRECTORY","status":"DONE","path":"private/path"}"#;
        assert_eq!(
            parse_transcript_line(read, "antigravity-ide").map(|item| item.title),
            Some("Reading files".into())
        );
        assert_eq!(
            parse_transcript_line(edit, "antigravity-ide").map(|item| item.title),
            Some("Editing code".into())
        );
        assert_eq!(
            parse_transcript_line(code_action, "antigravity-ide").map(|item| item.title),
            Some("Editing code".into())
        );
        assert_eq!(
            parse_transcript_line(list, "antigravity-ide").map(|item| item.title),
            Some("Reading files".into())
        );
    }

    #[test]
    fn parses_planner_response_without_tools_as_done() {
        let line = r#"{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-10-12T05:40:52Z","tool_calls":[]}"#;
        let update = parse_transcript_line(line, "antigravity-ide").expect("parsed update");
        assert_eq!(update.state, TaskState::Done);
        assert_eq!(update.title, "Antigravity IDE task completed");
    }

    #[test]
    fn parses_checkpoint_as_done() {
        let line = r#"{"step_index":3,"source":"SYSTEM","type":"CHECKPOINT","status":"DONE","created_at":"2026-10-12T05:40:53Z"}"#;
        let update = parse_transcript_line(line, "antigravity-cli").expect("parsed update");
        assert_eq!(update.state, TaskState::Done);
        assert_eq!(update.title, "Antigravity CLI task completed");
    }

    #[test]
    fn parses_error_status_as_error() {
        let line = r#"{"step_index":4,"source":"MODEL","type":"PLANNER_RESPONSE","status":"ERROR","created_at":"2026-10-12T05:40:54Z"}"#;
        let update = parse_transcript_line(line, "antigravity-ide").expect("parsed update");
        assert_eq!(update.state, TaskState::Error);
        assert_eq!(update.title, "Antigravity IDE task failed");
    }

    #[test]
    fn extracts_conversation_id_from_transcript_path() {
        let path = PathBuf::from(
            r"C:\Users\Admin\.gemini\antigravity-ide\brain\67ef455b-2679-4ce7-ad48-4233d7ca95ca\.system_generated\logs\transcript.jsonl",
        );
        assert_eq!(
            conversation_id_from_path(&path),
            Some("67ef455b-2679-4ce7-ad48-4233d7ca95ca".into())
        );
    }

    #[test]
    fn ignores_unknown_and_malformed_lines() {
        assert!(
            parse_transcript_line(r#"{"type":"KNOWLEDGE_ARTIFACTS"}"#, "antigravity-ide").is_none()
        );
        assert!(parse_transcript_line("not json", "antigravity-ide").is_none());
    }
}
