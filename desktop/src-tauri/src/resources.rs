//! Was die App selbst gerade verbraucht: CPU, Arbeitsspeicher und Threads – samt
//! ihrer Kindprozesse (WebView2-Fenster, ffmpeg von Self-Clip). Für die Anzeige
//! unter „Tweaks“, damit sichtbar ist, dass die App das Spiel nicht ausbremst.

use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::Instant,
};

use serde::Serialize;
use windows::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::{
        Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
        ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
        Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    },
};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Anteil an der gesamten CPU (alle Kerne = 100 %), wie im Task-Manager.
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub threads: u32,
    /// Nach Programm zusammengefasst: App, WebView2, ffmpeg …
    pub parts: Vec<Part>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub name: String,
    pub processes: u32,
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub threads: u32,
}

struct Entry {
    pid: u32,
    parent: u32,
    threads: u32,
    name: String,
}

/// Letzte Messung: CPU-Zeit je Prozess (100 ns) – die Auslastung ist die Differenz dazu.
static LAST: Mutex<Option<(Instant, HashMap<u32, u64>)>> = Mutex::new(None);

fn processes() -> Vec<Entry> {
    let mut out = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                out.push(Entry {
                    pid: entry.th32ProcessID,
                    parent: entry.th32ParentProcessID,
                    threads: entry.cntThreads,
                    name: String::from_utf16_lossy(&entry.szExeFile[..len]),
                });
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    out
}

/// Die App und alle Prozesse, die sie (auch indirekt) gestartet hat.
fn own_tree(all: &[Entry]) -> Vec<&Entry> {
    let mut members: HashSet<u32> = HashSet::from([std::process::id()]);
    // PIDs werden wiederverwendet: Ein Kind muss nach seinem Elternteil in der Liste
    // auftauchen dürfen, darum bis zur Ruhe wiederholen (der Baum ist flach).
    loop {
        let before = members.len();
        for entry in all {
            if members.contains(&entry.parent) && entry.pid != 0 {
                members.insert(entry.pid);
            }
        }
        if members.len() == before {
            break;
        }
    }
    all.iter().filter(|entry| members.contains(&entry.pid)).collect()
}

/// (CPU-Zeit in 100 ns, Arbeitsspeicher in Bytes) eines Prozesses.
fn times_and_memory(pid: u32) -> Option<(u64, u64)> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let (mut created, mut exited, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        let times = GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user);
        let mut counters = PROCESS_MEMORY_COUNTERS { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32, ..Default::default() };
        let memory = GetProcessMemoryInfo(process, &mut counters, counters.cb);
        let _ = CloseHandle(process);
        times.ok()?;
        let ticks = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
        Some((ticks(kernel) + ticks(user), if memory.is_ok() { counters.WorkingSetSize as u64 } else { 0 }))
    }
}

fn label(exe: &str) -> String {
    match exe.to_ascii_lowercase().as_str() {
        "msedgewebview2.exe" => "Fenster (WebView2)".into(),
        "ffmpeg.exe" => "Self-Clip (ffmpeg)".into(),
        "fib-desktop.exe" => "FIB Desktop".into(),
        _ => exe.trim_end_matches(".exe").to_string(),
    }
}

/// Misst den aktuellen Verbrauch. Die CPU-Auslastung bezieht sich auf die Zeit seit
/// dem letzten Aufruf; der allererste Aufruf misst dafür kurz (250 ms) selbst.
pub fn measure() -> Usage {
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if last.is_none() {
        *last = Some(sample().1);
        drop(last);
        std::thread::sleep(std::time::Duration::from_millis(250));
        last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    }
    let (rows, now) = sample();
    let (then, previous) = last.replace(now.clone()).unwrap_or((now.0, HashMap::new()));
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
    let elapsed_100ns = now.0.saturating_duration_since(then).as_nanos() as f64 / 100.0;

    let mut parts: Vec<Part> = Vec::new();
    for (entry, cpu_time, memory) in rows {
        // Neue Prozesse zählen ab jetzt; ohne Vorwert keine Auslastung erfinden.
        let used = previous.get(&entry.pid).map_or(0, |before| cpu_time.saturating_sub(*before)) as f64;
        let percent = if elapsed_100ns > 0.0 { used / elapsed_100ns / cores * 100.0 } else { 0.0 };
        let name = label(&entry.name);
        match parts.iter_mut().find(|part| part.name == name) {
            Some(part) => {
                part.processes += 1;
                part.cpu_percent += percent;
                part.memory_bytes += memory;
                part.threads += entry.threads;
            }
            None => parts.push(Part { name, processes: 1, cpu_percent: percent, memory_bytes: memory, threads: entry.threads }),
        }
    }
    parts.sort_by_key(|part| std::cmp::Reverse(part.memory_bytes));
    Usage {
        cpu_percent: parts.iter().map(|p| p.cpu_percent).sum(),
        memory_bytes: parts.iter().map(|p| p.memory_bytes).sum(),
        threads: parts.iter().map(|p| p.threads).sum(),
        parts,
    }
}

type Sample = (Vec<(Entry, u64, u64)>, (Instant, HashMap<u32, u64>));

fn sample() -> Sample {
    let all = processes();
    let at = Instant::now();
    let tree: Vec<u32> = own_tree(&all).iter().map(|e| e.pid).collect();
    let mut rows = Vec::new();
    let mut times = HashMap::new();
    for entry in all.into_iter().filter(|e| tree.contains(&e.pid)) {
        if let Some((cpu, memory)) = times_and_memory(entry.pid) {
            times.insert(entry.pid, cpu);
            rows.push((entry, cpu, memory));
        }
    }
    (rows, (at, times))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_the_own_process() {
        let usage = measure();
        assert!(usage.memory_bytes > 0, "{usage:?}");
        assert!(usage.threads > 0);
        assert!(usage.cpu_percent >= 0.0 && usage.cpu_percent <= 100.0 + 1e-6);
        // Ein bisschen Arbeit, dann muss die zweite Messung CPU-Zeit sehen.
        let started = Instant::now();
        let mut x = 0u64;
        while started.elapsed().as_millis() < 200 {
            x = std::hint::black_box(x.wrapping_mul(31).wrapping_add(7));
        }
        let busy = measure();
        assert!(busy.cpu_percent > 0.0, "{busy:?}");
    }
}
