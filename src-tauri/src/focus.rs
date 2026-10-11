#[cfg(windows)]
pub fn focus_process(pid: u32) -> Result<(), String> {
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetAncestor, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow,
        ShowWindow, GA_ROOT, SW_RESTORE,
    };

    struct WindowSearch {
        pids: Vec<u32>,
        matches: Vec<(usize, HWND)>,
    }

    unsafe extern "system" fn collect_windows(
        window: HWND,
        context: LPARAM,
    ) -> windows::core::BOOL {
        let search = unsafe { &mut *(context.0 as *mut WindowSearch) };
        if !unsafe { IsWindowVisible(window) }.as_bool()
            || unsafe { GetAncestor(window, GA_ROOT) } != window
        {
            return windows::core::BOOL(1);
        }
        let mut window_pid = 0;
        unsafe { GetWindowThreadProcessId(window, Some(&mut window_pid)) };
        if let Some(rank) = search
            .pids
            .iter()
            .position(|candidate| *candidate == window_pid)
        {
            search.matches.push((rank, window));
        }
        windows::core::BOOL(1)
    }

    if pid == 0 {
        return Err("Task process id is invalid".into());
    }

    let process_entries = process_snapshot()?;
    let candidate_pids = process_chain(pid, &process_entries);
    if candidate_pids.is_empty() {
        return Err("Task process is no longer running".into());
    }

    let mut search = WindowSearch {
        pids: candidate_pids,
        matches: Vec::new(),
    };
    let context = LPARAM((&mut search as *mut WindowSearch) as isize);
    unsafe { EnumWindows(Some(collect_windows), context) }
        .map_err(|error| format!("Could not find the task window: {error}"))?;
    search.matches.sort_by_key(|(rank, _)| *rank);
    let Some((_, window)) = search.matches.first() else {
        return Err("No visible window belongs to the task process tree".into());
    };
    let _ = unsafe { ShowWindow(*window, SW_RESTORE) };
    if unsafe { SetForegroundWindow(*window) }.as_bool() {
        Ok(())
    } else {
        Err("Windows did not allow focusing the task window".into())
    }
}

#[cfg(windows)]
pub fn focus_target_pid(pid: u32) -> u32 {
    let Ok(processes) = process_snapshot() else {
        return pid;
    };
    focus_pid_from_entry(pid, &processes)
}

#[cfg(not(windows))]
pub fn focus_target_pid(pid: u32) -> u32 {
    pid
}

#[cfg(not(windows))]
pub fn focus_process(_pid: u32) -> Result<(), String> {
    Err("Click-to-focus is available on Windows only".into())
}

#[derive(Clone)]
struct ProcessEntry {
    pid: u32,
    parent_pid: u32,
    image_name: String,
}

fn focus_pid_from_entry(pid: u32, processes: &[ProcessEntry]) -> u32 {
    let Some(process) = processes.iter().find(|process| process.pid == pid) else {
        return pid;
    };
    if !matches!(process.image_name.as_str(), "powershell.exe" | "pwsh.exe") {
        return pid;
    }
    processes
        .iter()
        .find(|candidate| candidate.pid == process.parent_pid)
        .map_or(pid, |parent| parent.pid)
}

#[cfg(windows)]
fn process_snapshot() -> Result<Vec<ProcessEntry>, String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|error| format!("Could not inspect task processes: {error}"))?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut processes = Vec::new();
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            processes.push(ProcessEntry {
                pid: entry.th32ProcessID,
                parent_pid: entry.th32ParentProcessID,
                image_name: String::from_utf16_lossy(&entry.szExeFile)
                    .trim_end_matches('\0')
                    .to_ascii_lowercase(),
            });
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    unsafe { CloseHandle(snapshot) }.map_err(|error| error.to_string())?;
    Ok(processes)
}

fn process_chain(start_pid: u32, processes: &[ProcessEntry]) -> Vec<u32> {
    let parents: std::collections::HashMap<u32, u32> = processes
        .iter()
        .map(|process| (process.pid, process.parent_pid))
        .collect();
    let mut chain = Vec::new();
    let mut current = start_pid;
    for _ in 0..32 {
        if chain.contains(&current) {
            break;
        }
        chain.push(current);
        let Some(parent) = parents.get(&current).copied() else {
            break;
        };
        if parent == current || parent == 0 || !parents.contains_key(&parent) {
            break;
        }
        current = parent;
    }
    chain
}

#[cfg(test)]
mod tests {
    use super::{focus_pid_from_entry, process_chain, ProcessEntry};

    #[test]
    fn process_chain_walks_from_task_to_window_host() {
        let processes = [
            ProcessEntry {
                pid: 12,
                parent_pid: 1,
                image_name: String::new(),
            },
            ProcessEntry {
                pid: 25,
                parent_pid: 12,
                image_name: String::new(),
            },
            ProcessEntry {
                pid: 38,
                parent_pid: 25,
                image_name: String::new(),
            },
            ProcessEntry {
                pid: 1,
                parent_pid: 0,
                image_name: String::new(),
            },
        ];

        assert_eq!(process_chain(38, &processes), [38, 25, 12, 1]);
    }

    #[test]
    fn process_chain_stops_for_missing_processes_and_cycles() {
        let processes = [
            ProcessEntry {
                pid: 38,
                parent_pid: 25,
                image_name: String::new(),
            },
            ProcessEntry {
                pid: 25,
                parent_pid: 38,
                image_name: String::new(),
            },
        ];

        assert_eq!(process_chain(38, &processes), [38, 25]);
        assert_eq!(process_chain(99, &processes), [99]);
    }

    #[test]
    fn focus_target_skips_short_lived_powershell_hook() {
        let processes = [
            ProcessEntry {
                pid: 25,
                parent_pid: 12,
                image_name: "pwsh.exe".into(),
            },
            ProcessEntry {
                pid: 12,
                parent_pid: 4,
                image_name: "codex.exe".into(),
            },
        ];

        assert_eq!(focus_pid_from_entry(25, &processes), 12);
        assert_eq!(focus_pid_from_entry(12, &processes), 12);
        assert_eq!(focus_pid_from_entry(99, &processes), 99);
    }
}
