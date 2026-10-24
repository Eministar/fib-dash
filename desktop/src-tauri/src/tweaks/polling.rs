//! Messung der tatsächlichen Abfragerate (Polling) von Mäusen über Raw Input.
//!
//! Ein unsichtbares Fenster empfängt für einige Sekunden die Raw-Input-Meldungen
//! aller Mäuse. Während der Nutzer die Maus bewegt, liefert jede Abfrage durch den
//! Host genau eine Meldung – gezählt pro 100 ms ergibt das die Rate in Hz.
//! Bestehende Raw-Input-Anmeldungen des Programms werden danach wiederhergestellt.

use std::{
    cell::RefCell,
    collections::HashMap,
    time::{Duration, Instant},
};

use serde::Serialize;
use windows::{
    core::w,
    Win32::{
        Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Input::{
                GetRawInputData, GetRawInputDeviceInfoW, GetRegisteredRawInputDevices, RegisterRawInputDevices, HRAWINPUT, RAWINPUT,
                RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RIDEV_REMOVE, RIDI_DEVICENAME, RID_INPUT, RIM_TYPEMOUSE,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, KillTimer, RegisterClassW, SetTimer,
                TranslateMessage, MSG, WINDOW_EX_STYLE, WM_INPUT, WM_TIMER, WNDCLASSW, WS_OVERLAPPED,
            },
        },
    },
};

use super::devices::{enumerate_input_devices, vid_pid, DeviceKind};
use super::model::{TweakError, TweakResult};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollingResult {
    pub device: String,
    pub vendor_id: Option<String>,
    pub product_id: Option<String>,
    pub events: usize,
    /// Gemessene Rate (75. Perzentil der 100-ms-Fenster mit Bewegung).
    pub measured_hz: Option<u32>,
    /// Nächstliegende übliche Rate (125/250/500/1000 …), wenn die Messung nah dran ist.
    pub nominal_hz: Option<u32>,
    pub note: Option<String>,
}

thread_local! {
    static EVENTS: RefCell<Vec<(isize, Instant)>> = const { RefCell::new(Vec::new()) };
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_INPUT {
        let mut raw = RAWINPUT::default();
        let mut size = std::mem::size_of::<RAWINPUT>() as u32;
        let read = GetRawInputData(
            HRAWINPUT(lparam.0 as *mut _),
            RID_INPUT,
            Some((&mut raw as *mut RAWINPUT).cast()),
            &mut size,
            std::mem::size_of::<RAWINPUTHEADER>() as u32,
        );
        if read != u32::MAX && raw.header.dwType == RIM_TYPEMOUSE.0 {
            let mouse = raw.data.mouse;
            // Nur Bewegungen zählen – Klicks kommen nicht im Abfragetakt.
            if mouse.lLastX != 0 || mouse.lLastY != 0 {
                let now = Instant::now();
                EVENTS.with(|events| events.borrow_mut().push((raw.header.hDevice.0 as isize, now)));
            }
        }
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

const NOMINAL_RATES: [u32; 7] = [125, 250, 500, 1000, 2000, 4000, 8000];

/// Rate aus Zeitstempeln: Meldungen je 100-ms-Fenster, nur Fenster mit Bewegung.
pub fn estimate_hz(times: &[Instant]) -> (Option<u32>, Option<u32>) {
    if times.len() < 30 {
        return (None, None);
    }
    let start = times[0];
    let mut buckets: HashMap<u128, u32> = HashMap::new();
    for t in times {
        *buckets.entry(t.duration_since(start).as_millis() / 100).or_default() += 1;
    }
    let last = buckets.keys().max().copied().unwrap_or(0);
    // Erstes und letztes Fenster sind angeschnitten.
    let mut counts: Vec<u32> = buckets.into_iter().filter(|(k, _)| *k != 0 && *k != last).map(|(_, c)| c).collect();
    if counts.len() < 3 {
        return (None, None);
    }
    counts.sort_unstable();
    let hz = counts[(counts.len() * 3) / 4] * 10;
    let nominal = NOMINAL_RATES.into_iter().find(|rate| (hz as f64 - *rate as f64).abs() <= *rate as f64 * 0.15);
    (Some(hz), nominal)
}

unsafe fn raw_device_name(handle: isize) -> Option<String> {
    let mut chars = 0u32;
    GetRawInputDeviceInfoW(Some(HANDLE(handle as *mut _)), RIDI_DEVICENAME, None, &mut chars);
    if chars == 0 {
        return None;
    }
    let mut buffer = vec![0u16; chars as usize];
    let read = GetRawInputDeviceInfoW(Some(HANDLE(handle as *mut _)), RIDI_DEVICENAME, Some(buffer.as_mut_ptr().cast()), &mut chars);
    (read != u32::MAX).then(|| String::from_utf16_lossy(&buffer).trim_end_matches('\0').to_string())
}

fn record(duration: Duration) -> TweakResult<Vec<(isize, Instant)>> {
    unsafe {
        let instance = GetModuleHandleW(None).map_err(|e| TweakError::os(e.message()))?;
        let class = WNDCLASSW { lpfnWndProc: Some(window_proc), hInstance: instance.into(), lpszClassName: w!("FibPollingMeasure"), ..Default::default() };
        // 0 = schon registriert (zweite Messung) – das ist in Ordnung.
        RegisterClassW(&class);
        let hwnd = CreateWindowExW(WINDOW_EX_STYLE(0), w!("FibPollingMeasure"), w!(""), WS_OVERLAPPED, 0, 0, 0, 0, None, None, Some(instance.into()), None)
            .map_err(|e| TweakError::os(format!("Messfenster: {}", e.message())))?;

        // Bisherige Anmeldungen merken, um sie danach exakt wiederherzustellen.
        let entry_size = std::mem::size_of::<RAWINPUTDEVICE>() as u32;
        let mut count = 0u32;
        GetRegisteredRawInputDevices(None, &mut count, entry_size);
        let mut previous = vec![RAWINPUTDEVICE::default(); count as usize];
        if count > 0 {
            GetRegisteredRawInputDevices(Some(previous.as_mut_ptr()), &mut count, entry_size);
        }
        let previous_mouse: Vec<RAWINPUTDEVICE> = previous.into_iter().filter(|d| d.usUsagePage == 1 && d.usUsage == 2).collect();

        let mouse = RAWINPUTDEVICE { usUsagePage: 1, usUsage: 2, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd };
        if let Err(error) = RegisterRawInputDevices(&[mouse], entry_size) {
            let _ = DestroyWindow(hwnd);
            return Err(TweakError::os(format!("Raw Input: {}", error.message())));
        }

        EVENTS.with(|events| events.borrow_mut().clear());
        SetTimer(Some(hwnd), 1, duration.as_millis() as u32, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.message == WM_TIMER && msg.hwnd == hwnd {
                break;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = KillTimer(Some(hwnd), 1);

        let restore = if previous_mouse.is_empty() {
            vec![RAWINPUTDEVICE { usUsagePage: 1, usUsage: 2, dwFlags: RIDEV_REMOVE, hwndTarget: HWND::default() }]
        } else {
            previous_mouse
        };
        let _ = RegisterRawInputDevices(&restore, entry_size);
        let _ = DestroyWindow(hwnd);
        Ok(EVENTS.with(|events| std::mem::take(&mut *events.borrow_mut())))
    }
}

/// Misst `duration` lang; währenddessen muss die Maus bewegt werden.
pub fn measure(duration: Duration) -> TweakResult<Vec<PollingResult>> {
    // Fenster und Nachrichtenschleife brauchen einen eigenen Thread.
    let events = std::thread::spawn(move || record(duration)).join().map_err(|_| TweakError::os("Messung abgebrochen"))??;
    let mut by_device: HashMap<isize, Vec<Instant>> = HashMap::new();
    for (device, time) in events {
        by_device.entry(device).or_default().push(time);
    }
    let known = enumerate_input_devices();
    let mut results: Vec<PollingResult> = by_device
        .into_iter()
        .map(|(handle, times)| {
            let path = unsafe { raw_device_name(handle) }.unwrap_or_default();
            let (vendor_id, product_id) = vid_pid(std::slice::from_ref(&path));
            let name = known
                .iter()
                .find(|d| d.kind == DeviceKind::Mouse && d.vendor_id.is_some() && d.vendor_id == vendor_id && d.product_id == product_id)
                .map(|d| d.name.clone())
                .unwrap_or_else(|| match (&vendor_id, &product_id) {
                    (Some(v), Some(p)) => format!("Maus (VID {v}, PID {p})"),
                    _ => "Maus".into(),
                });
            let (measured_hz, nominal_hz) = estimate_hz(&times);
            PollingResult {
                device: name,
                vendor_id,
                product_id,
                events: times.len(),
                note: measured_hz.is_none().then(|| "Zu wenig Bewegung – Maus während der Messung gleichmäßig bewegen.".to_string()),
                measured_hz,
                nominal_hz,
            }
        })
        .collect();
    results.sort_by_key(|r| std::cmp::Reverse(r.events));
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series(rate_hz: u32, seconds: f64) -> Vec<Instant> {
        let start = Instant::now();
        let step = Duration::from_secs_f64(1.0 / rate_hz as f64);
        (0..(rate_hz as f64 * seconds) as u32).map(|i| start + step * i).collect()
    }

    #[test]
    fn estimates_common_rates() {
        for rate in [125, 500, 1000] {
            let (hz, nominal) = estimate_hz(&series(rate, 2.0));
            assert_eq!(nominal, Some(rate), "gemessen {hz:?}");
        }
    }

    #[test]
    fn too_little_movement_gives_no_rate() {
        assert_eq!(estimate_hz(&series(1000, 0.01)), (None, None));
    }
}
