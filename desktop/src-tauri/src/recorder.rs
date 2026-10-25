//! FIB Self-Clip: eigene Hintergrundaufnahme wie NVIDIA Instant Replay.
//!
//! ffmpeg nimmt den Hauptmonitor über die Desktop Duplication auf (`ddagrab`)
//! und kodiert direkt auf der Grafikkarte (NVENC, AMF oder Quick Sync) – das
//! Bild verlässt die GPU nicht, das Spiel merkt davon praktisch nichts. Die
//! Aufnahme landet in 2-Sekunden-Stücken in einem Ringpuffer; „Speichern“
//! fügt die letzten Minuten verlustfrei zu einer MP4 zusammen.
//!
//! Den Ton liefert die App selbst (WASAPI-Loopback: was aus den Lautsprechern
//! kommt) über eine Pipe an ffmpeg.

use std::{
    io::Write,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

const FFMPEG_URL: &str = "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip";
const FFMPEG_SHA256: &str = "04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4";
const FFMPEG_DOWNLOAD_BYTES: u64 = 92_234_348;

const SEGMENT_SECONDS: u32 = 2;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// So viele Sekunden hält der Ringpuffer vor.
    pub buffer_seconds: u32,
    pub bitrate_mbps: u32,
    pub fps: u32,
    /// Spielton (Lautsprecher) mit aufnehmen.
    pub audio: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self { buffer_seconds: 120, bitrate_mbps: 15, fps: 60, audio: true }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    pub running: bool,
    /// z. B. "NVIDIA (NVENC)"
    pub encoder: Option<String>,
    pub buffered_seconds: u32,
    /// Woher der Ton gerade kommt (FiveM direkt oder Standardgerät).
    pub audio_source: Option<String>,
    pub error: Option<String>,
    pub download_bytes: u64,
}

/// Ein Windows-Job, der ffmpeg beendet, sobald die App endet – auch bei einem Absturz.
struct Job(windows::Win32::Foundation::HANDLE);

unsafe impl Send for Job {}

impl Job {
    fn for_child(child: &Child) -> Option<Job> {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let job = CreateJobObjectW(None, windows::core::PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            AssignProcessToJobObject(job, windows::Win32::Foundation::HANDLE(child.as_raw_handle())).ok()?;
            Some(Job(job))
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

struct Running {
    child: Child,
    _job: Option<Job>,
    audio_stop: Arc<AtomicBool>,
    audio_source: Arc<Mutex<String>>,
    started: Instant,
    encoder: &'static Encoder,
    buffer_seconds: u32,
}

#[derive(Default)]
pub struct Recorder {
    running: Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
    encoder: Mutex<Option<&'static Encoder>>,
}

pub struct Encoder {
    codec: &'static str,
    label: &'static str,
    /// Filter nach `ddagrab`, damit der Encoder die GPU-Bilder annimmt.
    filter: &'static str,
    args: &'static [&'static str],
}

/// In dieser Reihenfolge ausprobiert – Hardware zuerst, die CPU nur als Notlösung.
static ENCODERS: [Encoder; 4] = [
    Encoder { codec: "h264_nvenc", label: "NVIDIA (NVENC)", filter: "", args: &["-preset", "p1", "-tune", "ll", "-rc", "cbr", "-bf", "0"] },
    Encoder { codec: "h264_amf", label: "AMD (AMF)", filter: "", args: &["-usage", "lowlatency", "-rc", "cbr"] },
    Encoder { codec: "h264_qsv", label: "Intel (Quick Sync)", filter: ",hwmap=derive_device=qsv,format=qsv", args: &["-preset", "veryfast"] },
    Encoder { codec: "libx264", label: "Prozessor (langsam)", filter: ",hwdownload,format=bgra,format=yuv420p", args: &["-preset", "ultrafast", "-tune", "zerolatency"] },
];

pub fn ffmpeg_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join("ffmpeg").join("ffmpeg.exe"))
}

fn segments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map(|dir| dir.join("selfclip")).map_err(|e| e.to_string())
}

fn command(ffmpeg: &Path) -> Command {
    let mut command = Command::new(ffmpeg);
    command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS).stdin(Stdio::null()).stdout(Stdio::null());
    command
}

/// Probiert die Encoder mit drei echten Bildern vom Monitor durch.
fn detect_encoder(ffmpeg: &Path) -> Option<&'static Encoder> {
    ENCODERS.iter().find(|encoder| {
        let child = command(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-filter_complex"])
            .arg(format!("ddagrab=output_idx=0:framerate=30:draw_mouse=0{}", encoder.filter))
            .args(["-frames:v", "3", "-c:v", encoder.codec])
            .args(encoder.args)
            .args(["-f", "null", "-"])
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut child) = child else { return false };
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => return status.success(),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
                _ => {
                    let _ = child.kill();
                    return false;
                }
            }
        }
    })
}

#[derive(Clone, Copy)]
struct AudioFormat {
    rate: u32,
    channels: u16,
    float: bool,
}

/// Was ffmpeg immer bekommt – egal, woher der Ton gerade kommt.
const AUDIO_FORMAT: AudioFormat = AudioFormat { rate: 48_000, channels: 2, float: false };

impl AudioFormat {
    fn bytes_per_frame(&self) -> usize {
        self.channels as usize * if self.float { 4 } else { 2 }
    }

    fn wave(&self) -> windows::Win32::Media::Audio::WAVEFORMATEX {
        let block = self.bytes_per_frame() as u16;
        windows::Win32::Media::Audio::WAVEFORMATEX {
            wFormatTag: if self.float { 3 } else { 1 },
            nChannels: self.channels,
            nSamplesPerSec: self.rate,
            nAvgBytesPerSec: self.rate * block as u32,
            nBlockAlign: block,
            wBitsPerSample: if self.float { 32 } else { 16 },
            cbSize: 0,
        }
    }
}

/// Eine laufende WASAPI-Aufnahme samt Herkunft.
struct Capture {
    client: windows::Win32::Media::Audio::IAudioClient,
    capture: windows::Win32::Media::Audio::IAudioCaptureClient,
    /// Prozess, dessen Ton mitgeschnitten wird (`None` = Standard-Ausgabegerät).
    pid: Option<u32>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }
}

/// Startet einen Client im festen Format; Windows wandelt selbst um (AUTOCONVERTPCM).
unsafe fn start_client(client: windows::Win32::Media::Audio::IAudioClient, pid: Option<u32>) -> windows::core::Result<Capture> {
    use windows::Win32::{
        Media::Audio::{
            IAudioCaptureClient, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        },
        System::Threading::CreateEventW,
    };
    let wave = AUDIO_FORMAT.wave();
    let mut flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    if pid.is_some() {
        // Prozess-Loopback verlangt den Ereignis-Modus; abgeholt wird trotzdem im Takt.
        flags |= AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    }
    client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 2_000_000, 0, &wave, None)?;
    if pid.is_some() {
        let event = CreateEventW(None, false, false, windows::core::PCWSTR::null())?;
        client.SetEventHandle(event)?;
    }
    let capture: IAudioCaptureClient = client.GetService()?;
    client.Start()?;
    Ok(Capture { client, capture, pid })
}

/// Ton des Standard-Ausgabegeräts (alles, was aus Lautsprechern oder Headset kommt).
unsafe fn open_device_loopback() -> windows::core::Result<Capture> {
    use windows::Win32::{
        Media::Audio::{eConsole, eRender, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator},
        System::Com::{CoCreateInstance, CLSCTX_ALL},
    };
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
    let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
    start_client(client, None)
}

/// Meldet das Ende der asynchronen Aktivierung (muss „agil“ sein, siehe Microsoft-Doku).
#[windows::core::implement(windows::Win32::Media::Audio::IActivateAudioInterfaceCompletionHandler, windows::Win32::System::Com::IAgileObject)]
struct Activated(mpsc::SyncSender<()>);

impl windows::Win32::Media::Audio::IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
    fn ActivateCompleted(&self, _operation: windows::core::Ref<windows::Win32::Media::Audio::IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

impl windows::Win32::System::Com::IAgileObject_Impl for Activated_Impl {}

/// Nur der Ton eines Prozesses samt Kindprozessen (wie OBS „Anwendungsaudio“) –
/// unabhängig davon, auf welchem Gerät das Spiel ihn ausgibt.
unsafe fn open_process_loopback(pid: u32) -> windows::core::Result<Capture> {
    use windows::{
        core::Interface,
        Win32::{
            Media::Audio::{
                ActivateAudioInterfaceAsync, IActivateAudioInterfaceCompletionHandler, IAudioClient, AUDIOCLIENT_ACTIVATION_PARAMS,
                AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
                PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            },
            System::{
                Com::{StructuredStorage::PROPVARIANT, BLOB},
                Variant::VT_BLOB,
            },
        },
    };
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // Nie freigeben: Beim Drop würde PROPVARIANT den Blob mit CoTaskMemFree freigeben –
    // der zeigt aber auf `params` auf dem Stack (das führte zu einer Heap-Beschädigung).
    let mut prop = std::mem::ManuallyDrop::new(PROPVARIANT::default());
    {
        let inner = &mut *prop.Anonymous.Anonymous;
        inner.vt = VT_BLOB;
        inner.Anonymous.blob = BLOB {
            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            pBlobData: (&mut params as *mut AUDIOCLIENT_ACTIVATION_PARAMS).cast(),
        };
    }
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let handler: IActivateAudioInterfaceCompletionHandler = Activated(done_tx).into();
    let operation = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&*prop), &handler)?;
    done_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| windows::core::Error::new(windows::core::HRESULT(0x8000_000Au32 as i32), "Aktivierung des Prozess-Tons dauert zu lange"))?;
    let mut result = windows::core::HRESULT(0);
    let mut unknown = None;
    operation.GetActivateResult(&mut result, &mut unknown)?;
    result.ok()?;
    let client: IAudioClient = unknown.ok_or_else(|| windows::core::Error::from_hresult(windows::core::HRESULT(0x8000_4005u32 as i32)))?.cast()?;
    start_client(client, Some(pid))
}

/// Prozess-ID von FiveM (der Starter; das Spiel läuft als dessen Kindprozess).
pub fn find_game_pid() -> Option<u32> {
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
    };
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut launcher = None;
        let mut game = None;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase();
                if name == "fivem.exe" {
                    launcher = Some(entry.th32ProcessID);
                } else if name.starts_with("fivem_") && name.contains("gtaprocess") {
                    game = Some(entry.th32ProcessID);
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        launcher.or(game)
    }
}

/// Schreibt Ton im Takt der Uhr in ffmpeg. Läuft FiveM, kommt der Ton direkt aus
/// dem Spielprozess, sonst vom Standard-Ausgabegerät. Wenn nichts zu hören ist (oder
/// gar keine Quelle da ist), kommt Stille – sonst würde ffmpeg auf Ton warten und
/// das Bild anhalten.
fn audio_thread(
    enabled: bool,
    stop: Arc<AtomicBool>,
    source_label: Arc<Mutex<String>>,
    format_tx: mpsc::SyncSender<AudioFormat>,
    stdin_rx: mpsc::Receiver<ChildStdin>,
) {
    unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
    }
    let format = AUDIO_FORMAT;
    if format_tx.send(format).is_err() {
        return;
    }
    let Ok(mut stdin) = stdin_rx.recv() else { return };
    let frame_bytes = format.bytes_per_frame();
    let started = Instant::now();
    let mut written: u64 = 0;
    let mut buffer: Vec<u8> = Vec::new();
    let mut capture: Option<Capture> = None;
    let mut last_check = Instant::now() - Duration::from_secs(10);

    while !stop.load(Ordering::SeqCst) {
        // Alle zwei Sekunden prüfen, ob FiveM (neu) läuft oder beendet wurde.
        if enabled && last_check.elapsed() >= Duration::from_secs(2) {
            last_check = Instant::now();
            let game = find_game_pid();
            let wanted_matches = matches!((&capture, game), (Some(c), g) if c.pid == g);
            if !wanted_matches {
                // Alte Aufnahme erst beenden, dann die neue öffnen.
                drop(capture.take());
                capture = match game {
                    Some(pid) => unsafe { open_process_loopback(pid) }.ok().or_else(|| unsafe { open_device_loopback() }.ok()),
                    None => unsafe { open_device_loopback() }.ok(),
                };
                *source_label.lock().unwrap() = match &capture {
                    Some(Capture { pid: Some(_), .. }) => "FiveM (Spielton direkt)".into(),
                    Some(_) => "Standard-Ausgabegerät".into(),
                    None => "kein Ton".into(),
                };
            }
        }

        thread::sleep(Duration::from_millis(10));
        buffer.clear();
        if let Some(Capture { capture: client, .. }) = &capture {
            unsafe {
                while client.GetNextPacketSize().unwrap_or(0) > 0 {
                    let (mut data, mut frames, mut flags) = (std::ptr::null_mut(), 0u32, 0u32);
                    if client.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() {
                        break;
                    }
                    let len = frames as usize * frame_bytes;
                    // Bit 2 = AUDCLNT_BUFFERFLAGS_SILENT
                    if flags & 2 != 0 || data.is_null() {
                        buffer.resize(buffer.len() + len, 0);
                    } else {
                        buffer.extend_from_slice(std::slice::from_raw_parts(data, len));
                    }
                    let _ = client.ReleaseBuffer(frames);
                    written += frames as u64;
                }
            }
        }
        // Lücken (Stille, Quellenwechsel) bis auf 20 ms an die Uhr heranfüllen.
        let expected = (started.elapsed().as_secs_f64() * format.rate as f64) as u64;
        let slack = format.rate as u64 / 50;
        if expected > written + slack * 5 {
            let missing = expected - written - slack;
            buffer.resize(buffer.len() + missing as usize * frame_bytes, 0);
            written += missing;
        }
        if !buffer.is_empty() && stdin.write_all(&buffer).is_err() {
            break;
        }
    }
}

impl Recorder {
    pub fn status(&self, app: &AppHandle) -> Status {
        let mut guard = self.running.lock().unwrap();
        // Ist ffmpeg zwischendurch beendet worden?
        if let Some(running) = guard.as_mut() {
            if let Ok(Some(exit)) = running.child.try_wait() {
                *self.error.lock().unwrap() = Some(format!("Aufnahme unerwartet beendet ({exit}). {}", last_log_line(app)));
                running.audio_stop.store(true, Ordering::SeqCst);
                *guard = None;
            }
        }
        Status {
            installed: ffmpeg_path(app).is_some_and(|p| p.exists()),
            running: guard.is_some(),
            encoder: guard
                .as_ref()
                .map(|r| r.encoder.label.to_string())
                .or_else(|| self.encoder.lock().unwrap().map(|e| e.label.to_string())),
            buffered_seconds: guard.as_ref().map(|r| (r.started.elapsed().as_secs() as u32).min(r.buffer_seconds)).unwrap_or(0),
            audio_source: guard.as_ref().map(|r| r.audio_source.lock().unwrap().clone()),
            error: self.error.lock().unwrap().clone(),
            download_bytes: FFMPEG_DOWNLOAD_BYTES,
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().unwrap().is_some()
    }

    pub fn stop(&self) {
        if let Some(mut running) = self.running.lock().unwrap().take() {
            running.audio_stop.store(true, Ordering::SeqCst);
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }

    pub fn start(&self, app: &AppHandle, config: &Config) -> Result<(), String> {
        self.stop();
        *self.error.lock().unwrap() = None;
        let result = self.spawn(app, config);
        if let Err(error) = &result {
            *self.error.lock().unwrap() = Some(error.clone());
        }
        result
    }

    fn spawn(&self, app: &AppHandle, config: &Config) -> Result<(), String> {
        let ffmpeg = ffmpeg_path(app).filter(|p| p.exists()).ok_or("ffmpeg ist noch nicht installiert")?;
        self.spawn_with(&ffmpeg, &segments_dir(app)?, config)
    }

    fn spawn_with(&self, ffmpeg: &Path, dir: &Path, config: &Config) -> Result<(), String> {
        let ffmpeg = ffmpeg.to_path_buf();
        let dir = dir.to_path_buf();
        let encoder = {
            let mut cached = self.encoder.lock().unwrap();
            if cached.is_none() {
                *cached = detect_encoder(&ffmpeg);
            }
            cached.ok_or("Kein passender Video-Encoder gefunden – ist der Grafiktreiber aktuell?")?
        };

        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let fps = config.fps.clamp(24, 60);
        let bitrate = config.bitrate_mbps.clamp(4, 50);
        let buffer = config.buffer_seconds.clamp(15, 600);
        let wrap = buffer / SEGMENT_SECONDS + 3;

        let stop = Arc::new(AtomicBool::new(false));
        let (format_tx, format_rx) = mpsc::sync_channel(1);
        let (stdin_tx, stdin_rx) = mpsc::channel();
        let audio_stop = stop.clone();
        let audio_source = Arc::new(Mutex::new(String::from("wird gesucht …")));
        let label = audio_source.clone();
        let audio = config.audio;
        thread::Builder::new()
            .name("self-clip-ton".into())
            .spawn(move || audio_thread(audio, audio_stop, label, format_tx, stdin_rx))
            .map_err(|e| e.to_string())?;
        let format = format_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "Tonaufnahme startet nicht".to_string())?;

        let log = std::fs::File::create(dir.join("ffmpeg.log")).map_err(|e| e.to_string())?;
        let mut child = command(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-nostats", "-filter_complex"])
            .arg(format!("ddagrab=output_idx=0:framerate={fps}:draw_mouse=0{}[v]", encoder.filter))
            .args(["-thread_queue_size", "1024", "-use_wallclock_as_timestamps", "1", "-f", if format.float { "f32le" } else { "s16le" }])
            .args(["-ar", &format.rate.to_string(), "-ac", &format.channels.to_string(), "-i", "pipe:0"])
            .args(["-map", "[v]", "-map", "0:a", "-c:v", encoder.codec])
            .args(encoder.args)
            .args(["-b:v", &format!("{bitrate}M"), "-maxrate", &format!("{bitrate}M"), "-bufsize", &format!("{}M", bitrate * 2)])
            .args(["-g", &(fps * SEGMENT_SECONDS).to_string()])
            .args(["-af", "aresample=async=1000", "-c:a", "aac", "-b:a", "160k", "-ac", "2"])
            .args(["-f", "segment", "-segment_time", &SEGMENT_SECONDS.to_string(), "-segment_wrap", &wrap.to_string()])
            .args(["-reset_timestamps", "1", "-segment_format", "mpegts"])
            .arg(dir.join("seg%03d.ts"))
            .stdin(Stdio::piped())
            .stderr(Stdio::from(log))
            .spawn()
            .map_err(|e| format!("ffmpeg startet nicht: {e}"))?;
        let job = Job::for_child(&child);
        let stdin = child.stdin.take().ok_or("Keine Verbindung zu ffmpeg")?;
        let _ = stdin_tx.send(stdin);

        *self.running.lock().unwrap() = Some(Running { child, _job: job, audio_stop: stop, audio_source, started: Instant::now(), encoder, buffer_seconds: buffer });
        Ok(())
    }

    /// Fügt die letzten `seconds` Sekunden zu einer MP4 zusammen.
    pub fn save(&self, app: &AppHandle, seconds: u32, out_dir: &Path) -> Result<PathBuf, String> {
        if !self.is_running() {
            return Err(self.error.lock().unwrap().clone().unwrap_or_else(|| "Self-Clip nimmt gerade nicht auf".into()));
        }
        let ffmpeg = ffmpeg_path(app).ok_or("ffmpeg fehlt")?;
        Self::save_with(&ffmpeg, &segments_dir(app)?, seconds, out_dir)
    }

    fn save_with(ffmpeg: &Path, dir: &Path, seconds: u32, out_dir: &Path) -> Result<PathBuf, String> {
        let mut segments: Vec<(SystemTime, PathBuf)> = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|e| e == "ts"))
            .filter_map(|path| Some((std::fs::metadata(&path).ok()?.modified().ok()?, path)))
            .collect();
        segments.sort();
        let wanted = (seconds / SEGMENT_SECONDS + 1) as usize;
        let chosen: Vec<&PathBuf> = segments.iter().rev().take(wanted).rev().map(|(_, p)| p).collect();
        if chosen.is_empty() {
            return Err("Noch nichts aufgenommen".into());
        }

        let list = dir.join("speichern.txt");
        let content: String = chosen.iter().map(|p| format!("file '{}'\n", p.display().to_string().replace('\'', "'\\''"))).collect();
        std::fs::write(&list, content).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
        let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S");
        let target = out_dir.join(format!("Self-Clip {stamp}.mp4"));
        let status = command(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i"])
            .arg(&list)
            .args(["-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"])
            .arg(&target)
            .stderr(Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() || !target.exists() {
            return Err("Aufnahme konnte nicht gespeichert werden".into());
        }
        Ok(target)
    }
}

fn last_log_line(app: &AppHandle) -> String {
    segments_dir(app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("ffmpeg.log")).ok())
        .and_then(|log| log.lines().rev().find(|l| !l.trim().is_empty()).map(str::to_string))
        .unwrap_or_default()
}

/// Lädt ffmpeg (fest eingestellte Version, per SHA-256 geprüft) einmalig herunter.
pub async fn install(app: &AppHandle, client: &reqwest::Client) -> Result<(), String> {
    let target = ffmpeg_path(app).ok_or("Datenordner fehlt")?;
    let dir = target.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut response = client
        .get(FFMPEG_URL)
        .timeout(Duration::from_secs(900))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download fehlgeschlagen: {e}"))?;
    let mut data = Vec::with_capacity(FFMPEG_DOWNLOAD_BYTES as usize);
    let mut last_emit = Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Download abgebrochen: {e}"))? {
        data.extend_from_slice(&chunk);
        if last_emit.elapsed() > Duration::from_millis(200) {
            last_emit = Instant::now();
            let _ = app.emit("selfclip-install", serde_json::json!({ "received": data.len(), "total": FFMPEG_DOWNLOAD_BYTES }));
        }
    }
    let digest = Sha256::digest(&data);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    if hex != FFMPEG_SHA256 {
        return Err("Die heruntergeladene Datei ist beschädigt oder wurde verändert (Prüfsumme falsch).".into());
    }

    let dir_for_unzip = dir.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| e.to_string())?;
        for (name, file) in [("bin/ffmpeg.exe", "ffmpeg.exe"), ("LICENSE", "LICENSE.txt")] {
            let index = (0..archive.len())
                .find(|&i| archive.by_index(i).map(|f| f.name().ends_with(name)).unwrap_or(false))
                .ok_or_else(|| format!("{name} fehlt im Archiv"))?;
            let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
            let partial = dir_for_unzip.join(format!("{file}.part"));
            let mut out = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            drop(out);
            std::fs::rename(&partial, dir_for_unzip.join(file)).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("selfclip-install", serde_json::json!({ "received": FFMPEG_DOWNLOAD_BYTES, "total": FFMPEG_DOWNLOAD_BYTES, "done": true }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Prozess-Ton lässt sich aktivieren (hier für den eigenen Testprozess) und
    /// FiveM wird gefunden, falls es läuft: `cargo test -- --ignored process_loopback --nocapture`.
    #[test]
    #[ignore]
    fn process_loopback_activates() {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
            let capture = open_process_loopback(std::process::id()).expect("Prozess-Loopback aktivierbar");
            assert_eq!(capture.pid, Some(std::process::id()));
            thread::sleep(Duration::from_millis(300));
            let packet = capture.capture.GetNextPacketSize();
            println!("Prozess-Loopback läuft, Paketgröße: {packet:?}");
            let device = open_device_loopback().expect("Geräte-Loopback aktivierbar");
            assert_eq!(device.pid, None);
        }
        println!("FiveM-Prozess: {:?}", find_game_pid());
    }

    /// Nur Lautstärke messen, nichts speichern: `cargo test -- --ignored fivem_audio_level --nocapture`.
    #[test]
    #[ignore]
    fn fivem_audio_level() {
        let Some(pid) = std::env::var("FIB_PID").ok().and_then(|p| p.parse().ok()).or_else(find_game_pid) else {
            println!("FiveM läuft nicht");
            return;
        };
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
            let capture = if pid == 0 { open_device_loopback().unwrap() } else { open_process_loopback(pid).unwrap() };
            let (mut frames_total, mut sum_sq, mut peak) = (0usize, 0f64, 0i32);
            let until = Instant::now() + Duration::from_secs(2);
            while Instant::now() < until {
                thread::sleep(Duration::from_millis(10));
                while capture.capture.GetNextPacketSize().unwrap_or(0) > 0 {
                    let (mut data, mut frames, mut flags) = (std::ptr::null_mut(), 0u32, 0u32);
                    capture.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).unwrap();
                    if flags & 2 == 0 && !data.is_null() {
                        let samples = std::slice::from_raw_parts(data as *const i16, frames as usize * 2);
                        for &v in samples {
                            sum_sq += (v as f64) * (v as f64);
                            peak = peak.max((v as i32).abs());
                        }
                    }
                    frames_total += frames as usize;
                    let _ = capture.capture.ReleaseBuffer(frames);
                }
            }
            let rms = (sum_sq / (frames_total.max(1) * 2) as f64).sqrt();
            let db = 20.0 * (rms / 32768.0).max(1e-9).log10();
            println!("FiveM {pid}: {frames_total} Frames, Pegel {db:.1} dBFS, Spitze {peak}");
        }
    }

    /// Echte Aufnahme: ffmpeg aus `FIB_FFMPEG`, 10 s aufnehmen, die letzten 6 s speichern.
    #[test]
    #[ignore]
    fn records_and_saves_the_last_seconds() {
        let ffmpeg = PathBuf::from(std::env::var("FIB_FFMPEG").expect("FIB_FFMPEG setzen"));
        let base = std::env::temp_dir().join("fib-selfclip-test");
        let _ = std::fs::remove_dir_all(&base);
        let recorder = Recorder::default();
        let config = Config { buffer_seconds: 30, ..Config::default() };
        let started = Instant::now();
        recorder.spawn_with(&ffmpeg, &base.join("puffer"), &config).unwrap();
        println!("Encoder: {} (Start {:?})", recorder.encoder.lock().unwrap().unwrap().label, started.elapsed());
        thread::sleep(Duration::from_secs(10));
        assert!(recorder.running.lock().unwrap().as_mut().unwrap().child.try_wait().unwrap().is_none(), "ffmpeg läuft nicht mehr");
        let saved = Recorder::save_with(&ffmpeg, &base.join("puffer"), 6, &base.join("out")).unwrap();
        recorder.stop();
        let size = std::fs::metadata(&saved).unwrap().len();
        let duration = crate::media::duration_seconds(&saved).unwrap();
        println!("{} · {:.1} s · {:.1} MB", saved.display(), duration, size as f64 / 1048576.0);
        assert!((6.0..=10.5).contains(&duration), "{duration}");
        if let Ok(out) = std::process::Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "stream=codec_type,codec_name,start_time,duration", "-of", "compact"])
            .arg(&saved)
            .output()
        {
            let info = String::from_utf8_lossy(&out.stdout).to_string();
            println!("{info}");
            assert!(info.contains("codec_type=audio"), "keine Tonspur");
        }
        let _ = std::fs::remove_dir_all(&base);
    }
}
