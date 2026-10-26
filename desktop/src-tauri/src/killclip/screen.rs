//! Bildschirmausschnitte über Windows Graphics Capture (WGC). Das Spiel wird nicht
//! angefasst: Windows reicht uns nur fertige Bilder. Kopiert werden ausschließlich
//! die kleinen Bereiche, die wir auswerten. Staging-Texturen werden zwischen Scans wiederverwendet.
//!
//! Bewusst keine DXGI Desktop Duplication mehr: Solange eine Duplizierung offen ist,
//! kann Windows ein Vollbildspiel nicht mehr direkt anzeigen (Independent Flip) und
//! muss jedes Bild über den Compositor schicken. Im Messtest `presenting_fps` fiel ein
//! spielähnliches Vollbildfenster dadurch von ~650 auf ~250 FPS. WGC auf genau das
//! Vollbildfenster im Vordergrund, auf das Scan-Intervall gedrosselt, lag dort auf dem
//! Niveau ohne Aufnahme. Ohne Vollbildfenster wird der Monitor aufgenommen.

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use windows::{
    core::Interface,
    Foundation::TimeSpan,
    Graphics::{
        Capture::{Direct3D11CaptureFramePool, GraphicsCaptureAccess, GraphicsCaptureAccessKind, GraphicsCaptureItem, GraphicsCaptureSession},
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
    },
    Win32::{
        Foundation::{HMODULE, HWND, RECT},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
            Direct3D11::{
                D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_MAP_FLAG_DO_NOT_WAIT, D3D11_SDK_VERSION,
                D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
            },
            Dxgi::{
                Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC},
                CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1, DXGI_ERROR_WAS_STILL_DRAWING,
            },
            Gdi::{GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONULL},
        },
        System::{
            Performance::{QueryPerformanceCounter, QueryPerformanceFrequency},
            WinRT::{
                Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
                Graphics::Capture::IGraphicsCaptureItemInterop,
            },
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, IsIconic},
    },
};

/// Rechteck in Pixeln des Monitors.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Ein Bildausschnitt als BGRA-Pixel.
#[derive(Clone)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// Aufnahmezeit bleibt erhalten, auch wenn die GPU erst im nächsten Scan fertig ist.
pub struct CapturedFrame {
    pub images: Vec<Image>,
    pub at: Instant,
}

struct PendingFrame {
    regions: Vec<Region>,
    at: Instant,
}

impl Image {
    pub fn gray(&self) -> Vec<u8> {
        self.bgra
            .chunks_exact(4)
            .map(|p| ((p[2] as u32 * 77 + p[1] as u32 * 150 + p[0] as u32 * 29) >> 8) as u8)
            .collect()
    }

    /// Ausschnitt aus diesem Bild (z. B. die Hitmarker-Vorlage aus dem Screenshot).
    pub fn crop(&self, region: Region) -> Option<Image> {
        if region.width == 0 || region.height == 0 || region.x + region.width > self.width || region.y + region.height > self.height {
            return None;
        }
        let mut bgra = Vec::with_capacity((region.width * region.height * 4) as usize);
        for row in region.y..region.y + region.height {
            let start = ((row * self.width + region.x) * 4) as usize;
            bgra.extend_from_slice(&self.bgra[start..start + (region.width * 4) as usize]);
        }
        Some(Image { width: region.width, height: region.height, bgra })
    }

    /// Als 32-Bit-BMP speichern (für die Einrichtung im Fenster).
    pub fn save_bmp(&self, path: &std::path::Path) -> std::io::Result<()> {
        let size = self.bgra.len() as u32;
        let mut out = Vec::with_capacity(size as usize + 54);
        out.extend_from_slice(b"BM");
        out.extend_from_slice(&(54 + size).to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&54u32.to_le_bytes());
        out.extend_from_slice(&40u32.to_le_bytes());
        out.extend_from_slice(&(self.width as i32).to_le_bytes());
        // Negative Höhe = Zeilen von oben nach unten.
        out.extend_from_slice(&(-(self.height as i32)).to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&[0; 16]);
        out.extend_from_slice(&self.bgra);
        std::fs::write(path, out)
    }

    pub fn load_bmp(path: &std::path::Path) -> Option<Image> {
        let raw = std::fs::read(path).ok()?;
        if raw.len() < 54 || &raw[..2] != b"BM" {
            return None;
        }
        let offset = u32::from_le_bytes(raw[10..14].try_into().ok()?) as usize;
        let width = i32::from_le_bytes(raw[18..22].try_into().ok()?).unsigned_abs();
        let signed_height = i32::from_le_bytes(raw[22..26].try_into().ok()?);
        let height = signed_height.unsigned_abs();
        let bytes_per_pixel = (u16::from_le_bytes(raw[28..30].try_into().ok()?) / 8) as usize;
        if !(bytes_per_pixel == 3 || bytes_per_pixel == 4) {
            return None;
        }
        // Zeilen sind auf 4 Byte aufgefüllt; positive Höhe = von unten nach oben gespeichert.
        let stride = (width as usize * bytes_per_pixel + 3) & !3;
        let mut bgra = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height as usize {
            let row = if signed_height > 0 { height as usize - 1 - y } else { y };
            let line = raw.get(offset + row * stride..offset + row * stride + width as usize * bytes_per_pixel)?;
            for pixel in line.chunks_exact(bytes_per_pixel) {
                bgra.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
        }
        Some(Image { width, height, bgra })
    }
}

fn hr(error: windows::core::Error, what: &str) -> String {
    format!("{what}: {}", error.message())
}

/// Was aufgenommen wird: ein Vollbildfenster (meist das Spiel) oder der ganze Monitor.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Target {
    Window(isize),
    Monitor,
}

/// So oft wird geprüft, ob ein anderes Fenster im Vollbild vorne ist (Alt-Tab, Spielstart).
const TARGET_CHECK: Duration = Duration::from_secs(1);

/// So lange wartet ein Scan höchstens auf ein frisches Bild bzw. auf die fertige Kopie.
const FRESH_WAIT: Duration = Duration::from_millis(100);
const READ_WAIT: Duration = Duration::from_millis(30);

/// Eine laufende WGC-Aufnahme. Nur ein Puffer: Windows kopiert erst wieder ein Bild
/// hinein, wenn wir das vorige abgeholt haben – höchstens einmal pro Intervall.
struct Session {
    target: Target,
    interval: Duration,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

/// Nimmt den Hauptmonitor bzw. das Vollbildfenster darauf auf.
pub struct Screen {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt_device: IDirect3DDevice,
    monitor: isize,
    capture: Option<Session>,
    checked: Instant,
    /// Fenster, für das WGC abgelehnt hat – nicht jede Sekunde erneut versuchen.
    refused: Option<isize>,
    staging: Vec<ID3D11Texture2D>,
    staging_sizes: Vec<(u32, u32)>,
    pending: Option<PendingFrame>,
    pub width: u32,
    pub height: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Direct3D11::{D3D11_SUBRESOURCE_DATA, D3D11_USAGE_DEFAULT};

    unsafe fn copy_synthetic(screen: &mut Screen, texture: &ID3D11Texture2D, region: Region) -> Result<Image, String> {
        screen.queue_region(texture, region, 0)?;
        screen.context.Flush();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(image) = screen.read_region(0, true)? {
                return Ok(image);
            }
            if Instant::now() >= deadline {
                return Err("GPU-Test überschreitet Zeitlimit".into());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: windows::Win32::Foundation::WPARAM, lparam: windows::Win32::Foundation::LPARAM) -> windows::Win32::Foundation::LRESULT {
        windows::Win32::UI::WindowsAndMessaging::DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    /// Die frühere Erfassung (DXGI Desktop Duplication), nur noch zum Vergleich im Messtest.
    unsafe fn open_duplication() -> windows::Win32::Graphics::Dxgi::IDXGIOutputDuplication {
        use windows::Win32::Graphics::Dxgi::IDXGIOutput1;
        let factory: IDXGIFactory1 = CreateDXGIFactory1().unwrap();
        let adapter = factory.EnumAdapters1(0).unwrap();
        let (device, _) = create_device(&adapter).unwrap();
        for i in 0.. {
            let Ok(output) = adapter.EnumOutputs(i) else { break };
            let r = output.GetDesc().unwrap().DesktopCoordinates;
            if r.left == 0 && r.top == 0 {
                return output.cast::<IDXGIOutput1>().unwrap().DuplicateOutput(&device).unwrap();
            }
        }
        panic!("Hauptmonitor nicht am ersten Grafikchip");
    }

    /// Spielähnliches randloses Vollbildfenster (Flip-Modell, ungebremst) auf dem
    /// Hauptmonitor; misst dessen FPS ohne Aufnahme, mit der früheren Duplizierung und
    /// mit der jetzigen Erfassung im Takt des Kill-Feeds (500 ms) und des Markers (100 ms):
    /// `cargo test --release -- --ignored presenting_fps --nocapture --test-threads=1`.
    /// Der Monitor zeigt dabei rund eine Minute lang ein Testbild.
    #[test]
    #[ignore]
    fn presenting_fps_with_and_without_capture() {
        use std::sync::{atomic::{AtomicU8, Ordering}, Arc};
        use windows::core::w;
        use windows::Win32::{
            Graphics::{Direct3D::D3D_DRIVER_TYPE_HARDWARE, Direct3D11::*, Dxgi::*},
            System::LibraryLoader::GetModuleHandleW,
            UI::WindowsAndMessaging::*,
        };
        unsafe {
            let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let (w, h) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
            let instance = GetModuleHandleW(None).unwrap();
            let class = WNDCLASSW { lpfnWndProc: Some(window_proc), hInstance: instance.into(), lpszClassName: w!("fib-fps-test"), ..Default::default() };
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(WINDOW_EX_STYLE(0), w!("fib-fps-test"), w!("FIB FPS-Test"), WS_POPUP | WS_VISIBLE, 0, 0, w, h, None, None, Some(instance.into()), None).unwrap();
            let _ = SetForegroundWindow(hwnd);

            let (mut device, mut context) = (None, None);
            D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context)).unwrap();
            let (device, context): (ID3D11Device, ID3D11DeviceContext) = (device.unwrap(), context.unwrap());
            let factory: IDXGIFactory2 = CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0)).unwrap();
            let desc = DXGI_SWAP_CHAIN_DESC1 {
                Width: w as u32, Height: h as u32, Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT, BufferCount: 2,
                SwapEffect: DXGI_SWAP_EFFECT_FLIP_DISCARD, Flags: DXGI_SWAP_CHAIN_FLAG_ALLOW_TEARING.0 as u32,
                ..Default::default()
            };
            let swap = factory.CreateSwapChainForHwnd(&device, hwnd, &desc, None, None).unwrap();
            let back: ID3D11Texture2D = swap.GetBuffer(0).unwrap();
            // Last wie ein Spiel: viel Speicherbandbreite pro Bild.
            let load_desc = D3D11_TEXTURE2D_DESC {
                Width: w as u32, Height: h as u32, MipLevels: 1, ArraySize: 1, Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: D3D11_USAGE_DEFAULT, BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
                ..Default::default()
            };
            let mut load = None;
            device.CreateTexture2D(&load_desc, None, Some(&mut load)).unwrap();
            let load = load.unwrap();
            let mut rtv = None;
            device.CreateRenderTargetView(&load, None, Some(&mut rtv)).unwrap();
            let rtv = rtv.unwrap();

            // 0 = nichts, 1 = frühere Duplizierung (2 Hz), 2 = jetzige Erfassung 500 ms, 3 = jetzige Erfassung 100 ms.
            let mode = Arc::new(AtomicU8::new(0));
            let done = Arc::new(AtomicU8::new(0));
            let (m, d) = (mode.clone(), done.clone());
            let grabber = std::thread::spawn(move || {
                let region = [Region { x: 16, y: 208, width: 243, height: 119 }];
                let mut duplication = None;
                let mut screen: Option<Screen> = None;
                let mut frames = 0;
                while d.load(Ordering::SeqCst) == 0 {
                    let mode = m.load(Ordering::SeqCst);
                    if mode != 1 {
                        duplication = None;
                    }
                    if !matches!(mode, 2 | 3) && screen.take().is_some() {
                        println!("  (Bilder ausgewertet: {frames})");
                        frames = 0;
                    }
                    let tick = if mode == 3 { Duration::from_millis(100) } else { Duration::from_millis(500) };
                    match mode {
                        1 => {
                            let dup = duplication.get_or_insert_with(|| open_duplication());
                            let mut info = Default::default();
                            let mut resource = None;
                            if dup.AcquireNextFrame(0, &mut info, &mut resource).is_ok() {
                                let _ = dup.ReleaseFrame();
                            }
                        }
                        2 | 3 => {
                            let s = screen.get_or_insert_with(|| Screen::open().unwrap());
                            if s.grab(&region, tick).unwrap().is_some() {
                                frames += 1;
                            }
                        }
                        _ => {}
                    }
                    std::thread::sleep(tick);
                }
            });

            let selected: Vec<u8> = std::env::var("FIB_MODES").unwrap_or("0,1,0,2,0,3,0".into()).split(',').map(|v| v.parse().unwrap()).collect();
            let names = ["ohne Aufnahme", "frühere Duplizierung (2 Hz)", "jetzige Erfassung (500 ms)", "jetzige Erfassung (100 ms)"];
            let mut msg = MSG::default();
            for phase in selected {
                mode.store(phase, Ordering::SeqCst);
                let started = Instant::now();
                let mut times = Vec::new();
                let mut last = Instant::now();
                while started.elapsed() < Duration::from_secs(6) {
                    while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    for i in 0..12 {
                        context.ClearRenderTargetView(&rtv, &[i as f32 / 12.0, 0.2, 0.3, 1.0]);
                        context.CopyResource(&back, &load);
                    }
                    let _ = swap.Present(0, DXGI_PRESENT_ALLOW_TEARING);
                    let now = Instant::now();
                    // Erste 1,5 s je Phase: Windows schaltet den Darstellungsmodus um.
                    if started.elapsed() > Duration::from_millis(1500) {
                        times.push((now - last).as_secs_f64() * 1000.0);
                    }
                    last = now;
                }
                times.sort_by(|a, b| a.total_cmp(b));
                let avg = times.iter().sum::<f64>() / times.len() as f64;
                let p99 = times[times.len() * 99 / 100];
                let stalls = times.iter().filter(|t| **t > 50.0).count();
                let foreground = GetForegroundWindow() == hwnd;
                println!("{:30} {:7.1} FPS, P50 {:.2} ms, P99 {p99:.2} ms, Hänger >50 ms: {stalls}, vorne: {foreground}", names[phase as usize], 1000.0 / avg, times[times.len() / 2]);
            }
            done.store(1, Ordering::SeqCst);
            grabber.join().unwrap();
            let _ = DestroyWindow(hwnd);
        }
    }

    /// Echte Erfassung: liefert Bilder in Monitorgröße und den Bereich mit Inhalt.
    #[test]
    #[ignore]
    fn captures_regions_of_the_primary_monitor() {
        let mut screen = Screen::open().unwrap();
        let shot = screen.screenshot().unwrap();
        println!("Monitor {}×{}, Ziel {:?}", shot.width, shot.height, screen.capture.as_ref().map(|c| c.target));
        assert_eq!((shot.width, shot.height), (screen.width, screen.height));
        assert!(shot.bgra.iter().any(|&b| b != 0), "Bild ist schwarz");
    }

    /// Wie der Wächter im Kill-Feed-Takt: Liefert jeder Scan ein Bild? Die Erkennung
    /// braucht Lesungen im Abstand unter 0,9 s, sonst wird keine Meldung bestätigt.
    /// `cargo test --release -- --ignored frame_gaps --nocapture` (nur lesend, kein Fenster).
    #[test]
    #[ignore]
    fn frame_gaps_at_the_feed_tick() {
        let tick = Duration::from_millis(500);
        let mut screen = Screen::open().unwrap();
        let region = [Region { x: 16, y: 208, width: 243, height: 119 }];
        let started = Instant::now();
        let (mut stamps, mut ages) = (Vec::new(), Vec::new());
        while started.elapsed() < Duration::from_secs(10) {
            if let Some(frame) = screen.grab(&region, tick).unwrap() {
                ages.push(frame.at.elapsed().as_secs_f64());
                stamps.push(frame.at);
            }
            std::thread::sleep(tick);
        }
        let gaps: Vec<f64> = stamps.windows(2).map(|w| (w[1] - w[0]).as_secs_f64()).collect();
        let max = gaps.iter().copied().fold(0.0, f64::max);
        let oldest = ages.iter().copied().fold(0.0, f64::max);
        println!("Ziel {:?}: {} Bilder in 10 s, größte Lücke {max:.2} s, Lücken > 0,9 s: {}, ältestes Bild {oldest:.3} s", screen.capture.as_ref().map(|c| c.target), stamps.len(), gaps.iter().filter(|g| **g > 0.9).count());
        assert!(max < 0.9, "Lücken {gaps:?}");
    }

    /// Rohe Bildrate von WGC je Ziel (nur lesend): `cargo test --release -- --ignored raw_frame_rate --nocapture`.
    #[test]
    #[ignore]
    fn raw_frame_rate_per_target() {
        let screen = Screen::open().unwrap();
        let foreground = screen.choose_target();
        for target in [foreground, Target::Monitor] {
            for poll in [Duration::from_millis(16), Duration::from_millis(500)] {
                let session = screen.start_session(target, Duration::ZERO).unwrap();
                let started = Instant::now();
                let (mut frames, mut polls) = (0, 0);
                while started.elapsed() < Duration::from_secs(4) {
                    polls += 1;
                    if let Ok(frame) = session.pool.TryGetNextFrame() {
                        frames += 1;
                        let _ = frame.Close();
                    }
                    std::thread::sleep(poll);
                }
                println!("{target:?}, abgeholt alle {poll:?}: {frames} Bilder bei {polls} Abfragen in 4 s");
            }
        }
    }

    /// Wie wiederholtes Starten/Stoppen der Erkennung: jedes Mal ein neuer Thread.
    #[test]
    #[ignore]
    fn survives_repeated_start_and_stop() {
        for round in 0..30 {
            std::thread::spawn(move || {
                let mut screen = Screen::open().unwrap();
                let region = [Region { x: 0, y: 0, width: 64, height: 32 }];
                for _ in 0..4 {
                    screen.grab(&region, Duration::from_millis(50)).unwrap();
                    std::thread::sleep(Duration::from_millis(50));
                }
                if round % 3 == 0 {
                    screen.screenshot().unwrap();
                }
            })
            .join()
            .unwrap();
        }
    }

    /// Hardware-Test mit synthetischen Pixeln, ohne Bildschirmbilder zu lesen.
    #[test]
    #[ignore]
    fn reuses_staging_and_recreates_it_for_resized_crops() {
        let mut screen = Screen::open().unwrap();
        let pixels: Vec<u8> = (0..64 * 32).flat_map(|i| [(i % 256) as u8, 42, 123, 255]).collect();
        let desc = D3D11_TEXTURE2D_DESC {
            Width: 64, Height: 32, MipLevels: 1, ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            ..Default::default()
        };
        let data = D3D11_SUBRESOURCE_DATA { pSysMem: pixels.as_ptr().cast(), SysMemPitch: 64 * 4, SysMemSlicePitch: 0 };
        let mut texture = None;
        unsafe {
            screen.device.CreateTexture2D(&desc, Some(&data), Some(&mut texture)).unwrap();
            let texture = texture.unwrap();
            let region = Region { x: 0, y: 0, width: 64, height: 32 };
            let first = copy_synthetic(&mut screen, &texture, region).unwrap();
            assert_eq!(first.bgra, pixels);
            let staging = screen.staging[0].clone();
            for _ in 0..20 {
                assert_eq!(copy_synthetic(&mut screen, &texture, region).unwrap().bgra, pixels);
                assert_eq!(screen.staging[0].as_raw(), staging.as_raw());
            }
            let crop = Region { x: 2, y: 3, width: 16, height: 8 };
            let cropped = copy_synthetic(&mut screen, &texture, crop).unwrap();
            assert_eq!(cropped.bgra, first.crop(crop).unwrap().bgra);
            assert_ne!(screen.staging[0].as_raw(), staging.as_raw());
            assert!(screen.queue_region(&texture, Region { x: screen.width, ..crop }, 0).is_err());
        }
    }
}

// Die COM-Objekte benutzt immer nur, wer gerade die Sperre von `SHARED` hält.
unsafe impl Send for Screen {}

/// Eine gemeinsame Erfassung für Erkennung und Einrichtung (früher Pflicht, weil
/// Windows nur eine Duplizierung pro Prozess zuließ; spart weiterhin ein zweites Gerät).
static SHARED: std::sync::Mutex<Option<Screen>> = std::sync::Mutex::new(None);

/// Arbeitet mit der gemeinsamen Erfassung und öffnet sie bei Bedarf. Nach einem
/// Fehler wird sie geschlossen, damit der nächste Aufruf frisch verbindet.
pub fn with_screen<T>(f: impl FnOnce(&mut Screen) -> Result<T, String>) -> Result<T, String> {
    let mut slot = SHARED.lock().unwrap_or_else(|e| e.into_inner());
    if slot.is_none() {
        *slot = Some(Screen::open()?);
    }
    let result = f(slot.as_mut().unwrap());
    if result.is_err() {
        *slot = None;
    }
    result
}

/// Gibt den Monitor frei (Erkennung beendet). Die nächste Nutzung öffnet neu.
pub fn release() {
    *SHARED.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

unsafe fn create_device(adapter: &IDXGIAdapter1) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let mut device = None;
    let mut context = None;
    D3D11CreateDevice(
        adapter,
        D3D_DRIVER_TYPE_UNKNOWN,
        HMODULE::default(),
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        None,
        D3D11_SDK_VERSION,
        Some(&mut device),
        None,
        Some(&mut context),
    )
    .map_err(|e| hr(e, "Direct3D"))?;
    Ok((device.ok_or("Direct3D nicht verfügbar")?, context.ok_or("Direct3D nicht verfügbar")?))
}

/// Rechteck des Monitors in Bildschirmkoordinaten.
fn monitor_rect(monitor: isize) -> Option<RECT> {
    let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe { GetMonitorInfoW(HMONITOR(monitor as _), &mut info) }.as_bool().then_some(info.rcMonitor)
}

/// Uhrzeit von WGC-Bildern (QPC in 100 ns) in ein `Instant` umrechnen.
fn frame_instant(frame_time: TimeSpan) -> Instant {
    let now = Instant::now();
    let (mut counter, mut frequency) = (0i64, 0i64);
    unsafe {
        if QueryPerformanceCounter(&mut counter).is_err() || QueryPerformanceFrequency(&mut frequency).is_err() || frequency <= 0 {
            return now;
        }
    }
    let now_100ns = (counter as i128 * 10_000_000 / frequency as i128) as i64;
    let age = (now_100ns - frame_time.Duration).max(0) as u64;
    now.checked_sub(Duration::from_nanos(age * 100)).unwrap_or(now)
}

impl Screen {
    /// Öffnet den Hauptmonitor (der mit dem Ursprung 0,0) – dort läuft das Spiel.
    /// Die eigentliche Aufnahme startet erst beim ersten `grab`.
    ///
    /// Mit zwei Grafikchips (z. B. AMD im Prozessor + NVIDIA) wird das Gerät auf dem
    /// Chip angelegt, der den Monitor ansteuert – dann bleiben alle Kopien auf einem Chip.
    pub fn open() -> Result<Self, String> {
        unsafe {
            // Ein dauerhaftes MTA für den ganzen Prozess statt RoInitialize je Thread: Endet
            // der Wächter-Thread, bliebe sonst kein Apartment übrig, und die von windows-rs
            // zwischengespeicherten WinRT-Factories zeigten ins Leere (Absturz beim nächsten Start).
            static MTA: std::sync::Once = std::sync::Once::new();
            MTA.call_once(|| std::mem::forget(windows::Win32::System::Com::CoIncrementMTAUsage()));
            if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
                return Err("Windows-Bildschirmaufnahme nicht verfügbar (ab Windows 10 Version 1903)".into());
            }
            // Ohne gelben Rahmen um das Spiel; Desktop-Apps bekommen das ohne Nachfrage.
            static BORDERLESS: std::sync::Once = std::sync::Once::new();
            BORDERLESS.call_once(|| {
                let _ = GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless).and_then(|op| op.join());
            });
            let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(|e| hr(e, "DXGI"))?;
            let adapters: Vec<IDXGIAdapter1> = (0..).map_while(|i| factory.EnumAdapters1(i).ok()).collect();
            let mut primary = None;
            for (index, adapter) in adapters.iter().enumerate() {
                for output in (0..).map_while(|i| adapter.EnumOutputs(i).ok()) {
                    let desc = output.GetDesc().map_err(|e| hr(e, "Monitor"))?;
                    let r = desc.DesktopCoordinates;
                    if desc.AttachedToDesktop.as_bool() && r.left == 0 && r.top == 0 {
                        primary = Some((index, desc.Monitor.0 as isize, (r.right - r.left) as u32, (r.bottom - r.top) as u32));
                    }
                }
            }
            let (owner, monitor, width, height) = primary.ok_or("Kein Hauptmonitor gefunden")?;
            let order = std::iter::once(owner).chain((0..adapters.len()).filter(|i| *i != owner));
            let mut last_error = String::from("Bildschirmzugriff nicht möglich");
            for index in order {
                let (device, context) = match create_device(&adapters[index]) {
                    Ok(pair) => pair,
                    Err(error) => {
                        last_error = error;
                        continue;
                    }
                };
                let winrt_device = device
                    .cast::<IDXGIDevice>()
                    .and_then(|dxgi| CreateDirect3D11DeviceFromDXGIDevice(&dxgi))
                    .and_then(|inspectable| inspectable.cast::<IDirect3DDevice>());
                match winrt_device {
                    Ok(winrt_device) => return Ok(Self {
                        device, context, winrt_device, monitor, width, height,
                        capture: None, checked: Instant::now(), refused: None,
                        staging: Vec::new(), staging_sizes: Vec::new(), pending: None,
                    }),
                    Err(error) => last_error = hr(error, "Bildschirmzugriff"),
                }
            }
            Err(last_error)
        }
    }

    /// Fenster im Vordergrund, das genau den Hauptmonitor füllt (randloses Vollbild),
    /// sonst der Monitor selbst. Ein Vollbildspiel bleibt so direkt dargestellt.
    fn choose_target(&self) -> Target {
        unsafe {
            let window = GetForegroundWindow();
            if window.is_invalid() || IsIconic(window).as_bool() || Some(window.0 as isize) == self.refused {
                return Target::Monitor;
            }
            let mut rect = RECT::default();
            let on_primary = MonitorFromWindow(window, MONITOR_DEFAULTTONULL).0 as isize == self.monitor;
            if on_primary && GetWindowRect(window, &mut rect).is_ok() && monitor_rect(self.monitor) == Some(rect) {
                Target::Window(window.0 as isize)
            } else {
                Target::Monitor
            }
        }
    }

    fn start_session(&self, target: Target, interval: Duration) -> Result<Session, String> {
        unsafe {
            let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(|e| hr(e, "Bildschirmaufnahme"))?;
            let item: GraphicsCaptureItem = match target {
                Target::Window(window) => interop.CreateForWindow(HWND(window as _)),
                Target::Monitor => interop.CreateForMonitor(HMONITOR(self.monitor as _)),
            }
            .map_err(|e| hr(e, "Bildschirmaufnahme"))?;
            let size = item.Size().map_err(|e| hr(e, "Bildschirmaufnahme"))?;
            // Die Bereiche gelten in Monitorpixeln – nur ein Bild genau dieser Größe passt.
            if (size.Width as u32, size.Height as u32) != (self.width, self.height) {
                return Err("Aufnahme passt nicht zur Monitorgröße".into());
            }
            let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&self.winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 1, size)
                .map_err(|e| hr(e, "Bildschirmaufnahme"))?;
            let session = pool.CreateCaptureSession(&item).map_err(|e| hr(e, "Bildschirmaufnahme"))?;
            let session = Session { target, interval, pool, session };
            let _ = session.session.SetIsCursorCaptureEnabled(false);
            let _ = session.session.SetIsBorderRequired(false);
            // Bewusst kein SetMinUpdateInterval: Auf den Scan-Takt gedrosselt kam das nächste
            // Bild oft knapp nach dem Scan, real nur alle 1–2 s – zu selten, um eine
            // Kill-Meldung zu bestätigen (`frame_gaps_at_the_feed_tick`). Der einzelne Puffer
            // begrenzt die Kopien auch so auf eine pro Abholen, also eine pro Scan.
            session.session.StartCapture().map_err(|e| hr(e, "Bildschirmaufnahme starten"))?;
            Ok(session)
        }
    }

    /// Aufnahme passend zum aktuellen Vordergrund halten; wechselt das Ziel, neu starten.
    fn ensure_session(&mut self, interval: Duration) -> Result<(), String> {
        if self.capture.is_some() && self.checked.elapsed() < TARGET_CHECK {
            return Ok(());
        }
        self.checked = Instant::now();
        // Auflösungswechsel: Der Fehler lässt `with_screen` neu öffnen, der Wächter legt die Bereiche neu fest.
        let rect = monitor_rect(self.monitor).ok_or("Monitor nicht mehr verfügbar")?;
        if ((rect.right - rect.left) as u32, (rect.bottom - rect.top) as u32) != (self.width, self.height) {
            return Err("Bildschirmauflösung hat sich geändert".into());
        }
        let target = self.choose_target();
        if self.capture.as_ref().is_some_and(|c| c.target == target && c.interval == interval) {
            return Ok(());
        }
        self.pending = None;
        self.capture = None;
        self.capture = Some(match self.start_session(target, interval) {
            Ok(session) => session,
            Err(_) if target != Target::Monitor => {
                if let Target::Window(window) = target {
                    self.refused = Some(window);
                }
                self.start_session(Target::Monitor, interval)?
            }
            Err(error) => return Err(error),
        });
        Ok(())
    }

    /// Ein frisches Bild holen und die kleinen Ausschnitte gleich lesen (die Kopie
    /// dauert Mikrosekunden). Ist die GPU ausgelastet und die Kopie nach kurzer Zeit
    /// nicht fertig, bleibt sie ausstehend und wird im nächsten Scan gelesen – ohne neue
    /// Arbeit zu stauen. `interval` ist der Scan-Takt.
    pub fn grab(&mut self, regions: &[Region], interval: Duration) -> Result<Option<CapturedFrame>, String> {
        if self.pending.as_ref().is_some_and(|pending| pending.regions != regions) {
            self.pending = None;
        }
        if self.pending.is_some() {
            return self.read_pending(regions, Duration::ZERO);
        }
        self.grab_inner(regions, interval, false)?;
        self.read_pending(regions, READ_WAIT)
    }

    fn read_pending(&mut self, regions: &[Region], wait: Duration) -> Result<Option<CapturedFrame>, String> {
        let Some(pending) = self.pending.take() else { return Ok(None) };
        let deadline = Instant::now() + wait;
        let mut images = Vec::with_capacity(regions.len());
        for index in 0..regions.len() {
            loop {
                // Das erste Map ohne Warten meldet oft „noch nicht fertig“, obwohl die Kopie
                // kurz danach bereit ist – darum kurz nachfragen statt den Scan zu verlieren.
                if let Some(image) = unsafe { self.read_region(index, true)? } {
                    images.push(image);
                    break;
                }
                if Instant::now() >= deadline {
                    self.pending = Some(pending);
                    return Ok(None);
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        // Sehr alte Bilder nach GPU-Hängern dürfen keine nachträglichen Kills auslösen.
        Ok((pending.at.elapsed().as_secs_f64() <= 2.0).then_some(CapturedFrame { images, at: pending.at }))
    }

    fn grab_inner(&mut self, regions: &[Region], interval: Duration, any_frame: bool) -> Result<Option<Vec<Image>>, String> {
        if any_frame {
            // Einrichtungs-Screenshot darf eine ausstehende Live-Kopie nicht später
            // mit anderen Abmessungen oder anderem Bildinhalt zurückliefern.
            self.pending = None;
        }
        self.ensure_session(interval)?;
        let Some(capture) = &self.capture else { return Ok(None) };
        // Im einzigen Puffer liegt meist ein Bild, das Windows gleich nach dem letzten
        // Abholen hineinkopiert hat – einen ganzen Scan alt. Live verwerfen und kurz auf
        // ein frisches warten; sonst wären die Lesungen zu weit auseinander, um eine
        // Kill-Meldung zu bestätigen (`frame_gaps_at_the_feed_tick`).
        let stale = capture.pool.TryGetNextFrame().ok();
        let frame = if any_frame {
            stale
        } else {
            if let Some(stale) = stale {
                let _ = stale.Close();
            }
            let deadline = Instant::now() + FRESH_WAIT;
            loop {
                if let Ok(frame) = capture.pool.TryGetNextFrame() {
                    break Some(frame);
                }
                if Instant::now() >= deadline {
                    break None;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        };
        // Kein neues Bild (Bildschirm unverändert).
        let Some(frame) = frame else { return Ok(None) };
        let result = (|| unsafe {
            let size = frame.ContentSize().map_err(|e| hr(e, "Bild"))?;
            if (size.Width as u32, size.Height as u32) != (self.width, self.height) {
                // Fenster wurde verkleinert oder verlassen das Vollbild: Ziel neu wählen.
                self.capture = None;
                return Ok(None);
            }
            let at = frame.SystemRelativeTime().map(frame_instant).unwrap_or_else(|_| Instant::now());
            let texture: ID3D11Texture2D = frame
                .Surface()
                .and_then(|surface| surface.cast::<IDirect3DDxgiInterfaceAccess>())
                .and_then(|access| access.GetInterface())
                .map_err(|e| hr(e, "Bild"))?;
            self.staging.truncate(regions.len());
            self.staging_sizes.truncate(regions.len());
            for (index, region) in regions.iter().enumerate() {
                self.queue_region(&texture, *region, index)?;
            }
            if any_frame {
                let mut images = Vec::with_capacity(regions.len());
                for index in 0..regions.len() {
                    images.push(self.read_region(index, false)?.ok_or("Bild noch nicht verfügbar")?);
                }
                Ok(Some(images))
            } else {
                self.pending = Some(PendingFrame { regions: regions.to_vec(), at });
                // Einmal abschicken, bevor der Wächter schläft. Flush wartet
                // nicht auf Fertigstellung; Map(DO_NOT_WAIT) prüft beim nächsten Scan.
                self.context.Flush();
                Ok(None)
            }
        })();
        // Puffer sofort zurückgeben: Die Kopie ist eingereiht, Windows darf das nächste Bild liefern.
        let _ = frame.Close();
        result
    }

    unsafe fn queue_region(&mut self, texture: &ID3D11Texture2D, region: Region, index: usize) -> Result<(), String> {
        let width = region.width.min(self.width.saturating_sub(region.x));
        let height = region.height.min(self.height.saturating_sub(region.y));
        if width == 0 || height == 0 {
            return Err("Erkennungsbereich liegt außerhalb des Monitors".into());
        }
        if self.staging_sizes.get(index) != Some(&(width, height)) {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut staging = None;
            self.device.CreateTexture2D(&desc, None, Some(&mut staging)).map_err(|e| hr(e, "Zwischenspeicher"))?;
            let staging = staging.ok_or("Zwischenspeicher")?;
            if index < self.staging.len() {
                self.staging[index] = staging;
                self.staging_sizes[index] = (width, height);
            } else {
                self.staging.push(staging);
                self.staging_sizes.push((width, height));
            }
        }
        let staging = &self.staging[index];
        let source_box = D3D11_BOX { left: region.x, top: region.y, front: 0, right: region.x + width, bottom: region.y + height, back: 1 };
        self.context.CopySubresourceRegion(staging, 0, 0, 0, 0, texture, 0, Some(&source_box));
        Ok(())
    }

    unsafe fn read_region(&self, index: usize, nonblocking: bool) -> Result<Option<Image>, String> {
        let staging = &self.staging[index];
        let (width, height) = self.staging_sizes[index];
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        let flags = if nonblocking { D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32 } else { 0 };
        match self.context.Map(staging, 0, D3D11_MAP_READ, flags, Some(&mut mapped)) {
            Ok(()) => {}
            Err(error) if nonblocking && error.code() == DXGI_ERROR_WAS_STILL_DRAWING => return Ok(None),
            Err(error) => return Err(hr(error, "Bild lesen")),
        }
        let mut bgra = Vec::with_capacity((width * height * 4) as usize);
        for row in 0..height as usize {
            let line = std::slice::from_raw_parts((mapped.pData as *const u8).add(row * mapped.RowPitch as usize), (width * 4) as usize);
            bgra.extend_from_slice(line);
        }
        self.context.Unmap(staging, 0);
        Ok(Some(Image { width, height, bgra }))
    }

    /// Ganzer Monitor – für den Einrichtungs-Screenshot.
    #[cfg(test)]
    pub fn screenshot(&mut self) -> Result<Image, String> {
        let full = Region { x: 0, y: 0, width: self.width, height: self.height };
        // Das erste Bild nach dem Start kommt erst nach einem Moment.
        for _ in 0..20 {
            if let Some(mut images) = self.grab_inner(&[full], Duration::ZERO, true)? {
                return Ok(images.remove(0));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Kein Bild vom Monitor erhalten".into())
    }
}
