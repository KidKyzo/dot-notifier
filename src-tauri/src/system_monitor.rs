use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const HISTORY_SIZE: usize = 60;
const ALERT_HOLD: Duration = Duration::from_secs(30);
const ALERT_COOLDOWN: Duration = Duration::from_secs(5 * 60);
const METRIC_EVENT_ID: &str = "00000000-0000-4000-8000-000000000001";

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSample {
    pub captured_at: u64,
    pub cpu_percent: Option<f64>,
    pub gpu_percent: Option<f64>,
    pub memory_percent: Option<f64>,
    pub memory_used_mb: Option<u64>,
    pub memory_total_mb: Option<u64>,
    pub disk_read_bytes_per_second: Option<f64>,
    pub network_bytes_per_second: Option<f64>,
    pub vram_percent: Option<f64>,
    pub vram_used_mb: Option<u64>,
    pub vram_total_mb: Option<u64>,
    pub gpu_temperature_c: Option<u32>,
}

impl MetricsSample {
    fn alert_level(self) -> Option<AlertLevel> {
        let critical = self.gpu_temperature_c.is_some_and(|value| value > 90)
            || self.cpu_percent.is_some_and(|value| value > 90.0)
            || self.gpu_percent.is_some_and(|value| value > 90.0);
        if critical {
            return Some(AlertLevel::Critical);
        }
        let warning = self.gpu_temperature_c.is_some_and(|value| value > 80)
            || self.memory_percent.is_some_and(|value| value > 90.0);
        warning.then_some(AlertLevel::Warning)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AlertLevel {
    Warning,
    Critical,
}

#[derive(Default)]
struct AlertTracker {
    level: Option<AlertLevel>,
    since: Option<Instant>,
    last_alert: Option<Instant>,
}

impl AlertTracker {
    fn update(&mut self, level: Option<AlertLevel>, now: Instant) -> Option<AlertLevel> {
        let Some(level) = level else {
            self.level = None;
            self.since = None;
            return None;
        };

        if self.level != Some(level) {
            self.level = Some(level);
            self.since = Some(now);
        }
        let held_long_enough = self
            .since
            .is_some_and(|since| now.duration_since(since) >= ALERT_HOLD);
        let cooldown_elapsed = self
            .last_alert
            .is_none_or(|last| now.duration_since(last) >= ALERT_COOLDOWN);
        if held_long_enough && cooldown_elapsed {
            self.last_alert = Some(now);
            Some(level)
        } else {
            None
        }
    }
}

pub fn start(app: AppHandle, panel_open: Arc<AtomicBool>) {
    #[cfg(windows)]
    {
        let _ = thread::Builder::new()
            .name("dot-notifier-system-monitor".into())
            .spawn(move || monitor_loop(app, panel_open));
    }
    #[cfg(not(windows))]
    {
        let _ = (app, panel_open);
    }
}

#[cfg(windows)]
fn monitor_loop(app: AppHandle, panel_open: Arc<AtomicBool>) {
    let mut reader = WindowsMetricsReader::new();
    let mut history = VecDeque::with_capacity(HISTORY_SIZE);
    let mut alerts = AlertTracker::default();
    loop {
        if !screen_is_locked() {
            if let Some(sample) = reader.sample() {
                history.push_back(sample);
                if history.len() > HISTORY_SIZE {
                    history.pop_front();
                }
                emit_snapshot(&app, sample, &history);
                if let Some(level) = alerts.update(sample.alert_level(), Instant::now()) {
                    emit_alert(&app, sample, level);
                }
            }
        }
        let interval = if panel_open.load(Ordering::Relaxed) {
            Duration::from_millis(750)
        } else {
            Duration::from_secs(2)
        };
        thread::sleep(interval);
    }
}

#[cfg(windows)]
fn emit_snapshot(app: &AppHandle, current: MetricsSample, history: &VecDeque<MetricsSample>) {
    let _ = app.emit(
        "bus-event",
        serde_json::json!({
            "id": METRIC_EVENT_ID,
            "source": "system",
            "kind": "metric",
            "title": "System metrics",
            "meta": { "current": current, "history": history },
        }),
    );
}

#[cfg(windows)]
fn emit_alert(app: &AppHandle, sample: MetricsSample, level: AlertLevel) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64);
    let id = format!("00000000-0000-4000-8000-{timestamp:012x}");
    let status = match level {
        AlertLevel::Warning => "warn",
        AlertLevel::Critical => "crit",
    };
    let title = if level == AlertLevel::Critical {
        "System load is critical"
    } else {
        "System threshold exceeded"
    };
    let _ = app.emit(
        "bus-event",
        serde_json::json!({
            "id": id,
            "source": "system",
            "kind": "metric",
            "status": status,
            "title": title,
            "meta": { "current": sample },
        }),
    );
}

#[cfg(windows)]
struct WindowsMetricsReader {
    pdh: PdhReader,
    nvml: NvmlReader,
}

#[cfg(windows)]
impl WindowsMetricsReader {
    fn new() -> Self {
        Self {
            pdh: PdhReader::new(),
            nvml: NvmlReader::new(),
        }
    }

    fn sample(&mut self) -> Option<MetricsSample> {
        let captured_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_millis() as u64;
        let (memory_percent, memory_used_mb, memory_total_mb) = memory_usage()?;
        let gpu_metrics = self.nvml.sample();
        Some(MetricsSample {
            captured_at,
            cpu_percent: self.pdh.cpu_percent(),
            gpu_percent: gpu_metrics.gpu_percent.or_else(|| self.pdh.gpu_percent()),
            memory_percent: Some(memory_percent),
            memory_used_mb: Some(memory_used_mb),
            memory_total_mb: Some(memory_total_mb),
            disk_read_bytes_per_second: self.pdh.disk_read_bytes_per_second(),
            network_bytes_per_second: self.pdh.network_bytes_per_second(),
            vram_percent: gpu_metrics.vram_percent,
            vram_used_mb: gpu_metrics.vram_used_mb,
            vram_total_mb: gpu_metrics.vram_total_mb,
            gpu_temperature_c: gpu_metrics.gpu_temperature_c,
        })
    }
}

#[cfg(windows)]
#[repr(C)]
struct MemoryStatusEx {
    length: u32,
    memory_load: u32,
    total_physical: u64,
    available_physical: u64,
    total_page_file: u64,
    available_page_file: u64,
    total_virtual: u64,
    available_virtual: u64,
    available_extended_virtual: u64,
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
}

#[cfg(windows)]
fn memory_usage() -> Option<(f64, u64, u64)> {
    let mut status = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        memory_load: 0,
        total_physical: 0,
        available_physical: 0,
        total_page_file: 0,
        available_page_file: 0,
        total_virtual: 0,
        available_virtual: 0,
        available_extended_virtual: 0,
    };
    // Windows fills the structure when the pointer and size are valid.
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 || status.total_physical == 0 {
        return None;
    }
    let used = status
        .total_physical
        .saturating_sub(status.available_physical);
    Some((
        f64::from(status.memory_load),
        used / 1_048_576,
        status.total_physical / 1_048_576,
    ))
}

#[cfg(windows)]
#[link(name = "pdh")]
unsafe extern "system" {
    fn PdhOpenQueryW(
        data_source: *const u16,
        user_data: usize,
        query: *mut *mut std::ffi::c_void,
    ) -> u32;
    fn PdhAddEnglishCounterW(
        query: *mut std::ffi::c_void,
        path: *const u16,
        user_data: usize,
        counter: *mut *mut std::ffi::c_void,
    ) -> u32;
    fn PdhCollectQueryData(query: *mut std::ffi::c_void) -> u32;
    fn PdhGetFormattedCounterValue(
        counter: *mut std::ffi::c_void,
        format: u32,
        counter_type: *mut u32,
        value: *mut PdhFormattedValue,
    ) -> u32;
    fn PdhExpandWildCardPathW(
        data_source: *const u16,
        path: *const u16,
        buffer: *mut u16,
        buffer_size: *mut u32,
        flags: u32,
    ) -> u32;
    fn PdhCloseQuery(query: *mut std::ffi::c_void) -> u32;
}

#[cfg(windows)]
#[repr(C)]
union PdhValueUnion {
    double_value: f64,
    long_value: i32,
    large_value: i64,
}

#[cfg(windows)]
#[repr(C)]
struct PdhFormattedValue {
    status: u32,
    value: PdhValueUnion,
}

#[cfg(windows)]
struct PdhReader {
    query: *mut std::ffi::c_void,
    cpu: Option<*mut std::ffi::c_void>,
    disk_read: Option<*mut std::ffi::c_void>,
    network: Vec<*mut std::ffi::c_void>,
    gpu: Vec<*mut std::ffi::c_void>,
}

#[cfg(windows)]
impl PdhReader {
    fn new() -> Self {
        let mut query = std::ptr::null_mut();
        // PDH owns the query and its counters until close.
        if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
            return Self {
                query: std::ptr::null_mut(),
                cpu: None,
                disk_read: None,
                network: Vec::new(),
                gpu: Vec::new(),
            };
        }
        let cpu = add_counter(query, "\\Processor(_Total)\\% Processor Time");
        let disk_read = add_counter(query, "\\PhysicalDisk(_Total)\\Disk Read Bytes/sec");
        let network = expand_counter_paths("\\Network Interface(*)\\Bytes Total/sec")
            .into_iter()
            .filter_map(|path| add_counter(query, &path))
            .collect();
        let gpu = expand_gpu_paths()
            .into_iter()
            .filter_map(|path| add_counter(query, &path))
            .collect();
        Self {
            query,
            cpu,
            disk_read,
            network,
            gpu,
        }
    }

    fn collect(&self) -> bool {
        !self.query.is_null() && unsafe { PdhCollectQueryData(self.query) } == 0
    }

    fn cpu_percent(&self) -> Option<f64> {
        if !self.collect() {
            return None;
        }
        self.cpu
            .and_then(counter_value)
            .map(|value| value.clamp(0.0, 100.0))
    }

    fn gpu_percent(&self) -> Option<f64> {
        if !self.collect() || self.gpu.is_empty() {
            return None;
        }
        let total = self
            .gpu
            .iter()
            .filter_map(|counter| counter_value(*counter))
            .sum::<f64>();
        Some(total.clamp(0.0, 100.0))
    }

    fn disk_read_bytes_per_second(&self) -> Option<f64> {
        if !self.collect() {
            return None;
        }
        self.disk_read
            .and_then(counter_value)
            .map(|value| value.max(0.0))
    }

    fn network_bytes_per_second(&self) -> Option<f64> {
        if !self.collect() || self.network.is_empty() {
            return None;
        }
        Some(
            self.network
                .iter()
                .filter_map(|counter| counter_value(*counter))
                .sum::<f64>()
                .max(0.0),
        )
    }
}

#[cfg(windows)]
impl Drop for PdhReader {
    fn drop(&mut self) {
        if !self.query.is_null() {
            let _ = unsafe { PdhCloseQuery(self.query) };
        }
    }
}

#[cfg(windows)]
fn add_counter(query: *mut std::ffi::c_void, path: &str) -> Option<*mut std::ffi::c_void> {
    let wide = path.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut counter = std::ptr::null_mut();
    (unsafe { PdhAddEnglishCounterW(query, wide.as_ptr(), 0, &mut counter) } == 0)
        .then_some(counter)
}

#[cfg(windows)]
fn counter_value(counter: *mut std::ffi::c_void) -> Option<f64> {
    let mut value = PdhFormattedValue {
        status: 0,
        value: PdhValueUnion { double_value: 0.0 },
    };
    if unsafe { PdhGetFormattedCounterValue(counter, 0x200, std::ptr::null_mut(), &mut value) } != 0
        || value.status != 0
    {
        return None;
    }
    let number = unsafe { value.value.double_value };
    number.is_finite().then_some(number)
}

#[cfg(windows)]
fn expand_gpu_paths() -> Vec<String> {
    expand_counter_paths("\\GPU Engine(*)\\Utilization Percentage")
}

#[cfg(windows)]
fn expand_counter_paths(counter_path: &str) -> Vec<String> {
    let path = counter_path
        .encode_utf16()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let mut size = 0;
    let result = unsafe {
        PdhExpandWildCardPathW(
            std::ptr::null(),
            path.as_ptr(),
            std::ptr::null_mut(),
            &mut size,
            0,
        )
    };
    if result == 0 || size == 0 {
        return Vec::new();
    }
    let mut buffer = vec![0_u16; size as usize];
    if unsafe {
        PdhExpandWildCardPathW(
            std::ptr::null(),
            path.as_ptr(),
            buffer.as_mut_ptr(),
            &mut size,
            0,
        )
    } != 0
    {
        return Vec::new();
    }
    buffer
        .split(|unit| *unit == 0)
        .take_while(|part| !part.is_empty())
        .filter_map(|part| String::from_utf16(part).ok())
        .collect()
}

#[cfg(windows)]
#[derive(Default)]
struct GpuMetrics {
    gpu_percent: Option<f64>,
    vram_percent: Option<f64>,
    vram_used_mb: Option<u64>,
    vram_total_mb: Option<u64>,
    gpu_temperature_c: Option<u32>,
}

#[cfg(windows)]
struct NvmlReader {
    library: *mut std::ffi::c_void,
    initialized: bool,
}

#[cfg(windows)]
#[repr(C)]
struct NvmlUtilization {
    gpu: u32,
    memory: u32,
}

#[cfg(windows)]
#[derive(Clone, Copy)]
#[repr(C)]
struct NvmlMemory {
    total: u64,
    free: u64,
    used: u64,
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryExW(
        name: *const u16,
        file: *mut std::ffi::c_void,
        flags: u32,
    ) -> *mut std::ffi::c_void;
    fn GetProcAddress(module: *mut std::ffi::c_void, name: *const u8) -> *mut std::ffi::c_void;
    fn FreeLibrary(module: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn OpenInputDesktop(flags: u32, inherit: i32, access: u32) -> *mut std::ffi::c_void;
    fn CloseDesktop(desktop: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
impl NvmlReader {
    fn new() -> Self {
        let mut result = Self {
            library: std::ptr::null_mut(),
            initialized: false,
        };
        for name in ["nvml.dll", "nvml64.dll"] {
            let wide = name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
            result.library =
                unsafe { LoadLibraryExW(wide.as_ptr(), std::ptr::null_mut(), 0x0000_0800) };
            if !result.library.is_null() {
                break;
            }
        }
        if !result.library.is_null() {
            type Init = unsafe extern "C" fn() -> i32;
            if let Some(init) = result.function::<Init>(b"nvmlInit_v2\0") {
                result.initialized = unsafe { init() } == 0;
            }
        }
        result
    }

    fn function<T: Copy>(&self, name: &'static [u8]) -> Option<T> {
        let address = unsafe { GetProcAddress(self.library, name.as_ptr()) };
        (!address.is_null()).then(|| unsafe { std::mem::transmute_copy(&address) })
    }

    fn sample(&self) -> GpuMetrics {
        if !self.initialized {
            return GpuMetrics::default();
        }
        type DeviceByIndex = unsafe extern "C" fn(u32, *mut *mut std::ffi::c_void) -> i32;
        type Utilization = unsafe extern "C" fn(*mut std::ffi::c_void, *mut NvmlUtilization) -> i32;
        type MemoryInfo = unsafe extern "C" fn(*mut std::ffi::c_void, *mut NvmlMemory) -> i32;
        type Temperature = unsafe extern "C" fn(*mut std::ffi::c_void, u32, *mut u32) -> i32;
        let Some(device_by_index) =
            self.function::<DeviceByIndex>(b"nvmlDeviceGetHandleByIndex_v2\0")
        else {
            return GpuMetrics::default();
        };
        let mut device = std::ptr::null_mut();
        if unsafe { device_by_index(0, &mut device) } != 0 {
            return GpuMetrics::default();
        }
        let mut utilization = NvmlUtilization { gpu: 0, memory: 0 };
        let gpu = self
            .function::<Utilization>(b"nvmlDeviceGetUtilizationRates\0")
            .and_then(|function| {
                (unsafe { function(device, &mut utilization) } == 0)
                    .then_some(f64::from(utilization.gpu))
            });
        let mut memory = NvmlMemory {
            total: 0,
            free: 0,
            used: 0,
        };
        let memory = self
            .function::<MemoryInfo>(b"nvmlDeviceGetMemoryInfo\0")
            .and_then(|function| {
                (unsafe { function(device, &mut memory) } == 0 && memory.total > 0)
                    .then_some(memory)
            });
        let mut temperature = 0;
        let temperature = self
            .function::<Temperature>(b"nvmlDeviceGetTemperature\0")
            .and_then(|function| {
                (unsafe { function(device, 0, &mut temperature) } == 0).then_some(temperature)
            });
        let total = memory.map(|value| value.total / 1_048_576);
        let used = memory.map(|value| value.used / 1_048_576);
        let percent = memory.and_then(|value| {
            (value.total > 0).then_some((value.used as f64 / value.total as f64) * 100.0)
        });
        GpuMetrics {
            gpu_percent: gpu,
            vram_percent: percent,
            vram_used_mb: used,
            vram_total_mb: total,
            gpu_temperature_c: temperature,
        }
    }
}

#[cfg(windows)]
impl Drop for NvmlReader {
    fn drop(&mut self) {
        if !self.library.is_null() {
            if self.initialized {
                type Shutdown = unsafe extern "C" fn() -> i32;
                if let Some(shutdown) = self.function::<Shutdown>(b"nvmlShutdown\0") {
                    let _ = unsafe { shutdown() };
                }
            }
            let _ = unsafe { FreeLibrary(self.library) };
        }
    }
}

#[cfg(windows)]
fn screen_is_locked() -> bool {
    const DESKTOP_SWITCHDESKTOP: u32 = 0x0100;
    let desktop = unsafe { OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP) };
    if desktop.is_null() {
        return true;
    }
    let _ = unsafe { CloseDesktop(desktop) };
    false
}

#[cfg(test)]
mod tests {
    use super::{AlertLevel, AlertTracker, MetricsSample, ALERT_COOLDOWN, ALERT_HOLD};
    use std::time::{Duration, Instant};

    fn sample(cpu: Option<f64>, memory: Option<f64>, temperature: Option<u32>) -> MetricsSample {
        MetricsSample {
            captured_at: 0,
            cpu_percent: cpu,
            gpu_percent: None,
            memory_percent: memory,
            memory_used_mb: None,
            memory_total_mb: None,
            disk_read_bytes_per_second: None,
            network_bytes_per_second: None,
            vram_percent: None,
            vram_used_mb: None,
            vram_total_mb: None,
            gpu_temperature_c: temperature,
        }
    }

    #[test]
    fn system_alerts_require_a_sustained_threshold_and_respect_cooldown() {
        let start = Instant::now();
        let mut alerts = AlertTracker::default();
        assert_eq!(
            alerts.update(sample(None, Some(91.0), None).alert_level(), start),
            None
        );
        assert_eq!(
            alerts.update(
                sample(None, Some(91.0), None).alert_level(),
                start + ALERT_HOLD - Duration::from_secs(1)
            ),
            None
        );
        assert_eq!(
            alerts.update(
                sample(None, Some(91.0), None).alert_level(),
                start + ALERT_HOLD
            ),
            Some(AlertLevel::Warning)
        );
        assert_eq!(
            alerts.update(
                sample(Some(95.0), None, None).alert_level(),
                start + ALERT_HOLD + Duration::from_secs(1)
            ),
            None
        );
        assert_eq!(
            alerts.update(
                sample(Some(95.0), None, None).alert_level(),
                start + ALERT_HOLD + ALERT_COOLDOWN
            ),
            Some(AlertLevel::Critical)
        );
    }

    #[test]
    fn threshold_boundaries_match_the_prd_defaults() {
        assert_eq!(sample(None, Some(90.0), Some(80)).alert_level(), None);
        assert_eq!(
            sample(None, Some(91.0), Some(80)).alert_level(),
            Some(AlertLevel::Warning)
        );
        assert_eq!(
            sample(None, None, Some(91)).alert_level(),
            Some(AlertLevel::Critical)
        );
        assert_eq!(
            sample(Some(91.0), None, None).alert_level(),
            Some(AlertLevel::Critical)
        );
    }
}
