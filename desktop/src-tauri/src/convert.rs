//! Clips zuschneiden und komprimieren mit dem in Windows eingebauten
//! MediaTranscoder. Nutzt die Hardware-Encoder der Grafikkarte (NVENC, Quick
//! Sync, AMF) und braucht keine zusätzlichen Programme. Ergebnis ist H.264/AAC
//! als MP4 – spielt in jedem Browser, der Server muss nichts mehr umwandeln.
//!
//! Wiederverwendbar für alle Aufnahmen der App (Bodycam, später Kill-Clips).

use std::path::{Path, PathBuf};

use serde::Deserialize;
use windows::{
    core::HSTRING,
    Foundation::TimeSpan,
    Media::{
        MediaProperties::{MediaEncodingProfile, VideoEncodingQuality},
        Transcoding::MediaTranscoder,
    },
    Storage::{CreationCollisionOption, StorageFile, StorageFolder},
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};
use windows_future::AsyncActionProgressHandler;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub enum Quality {
    /// Format der Quelle beibehalten, nur schneiden.
    #[serde(rename = "original")]
    Original,
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "720p")]
    P720,
}

impl Quality {
    /// (Zielhöhe, Videobitrate) – bewusst sparsam, Bodycams brauchen keine Kinoqualität.
    fn target(self) -> Option<(u32, u32)> {
        match self {
            Quality::Original => None,
            Quality::P1080 => Some((1080, 6_000_000)),
            Quality::P720 => Some((720, 3_000_000)),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Job {
    /// Ausschnitt in Sekunden; `None` = ganze Aufnahme.
    pub range: Option<(f64, f64)>,
    pub duration: f64,
    pub quality: Quality,
}

const MAX_FPS: u32 = 30;

pub(crate) fn span(seconds: f64) -> TimeSpan {
    TimeSpan { Duration: (seconds.max(0.0) * 10_000_000.0).round() as i64 }
}

/// WinRT akzeptiert nur absolute Pfade mit Backslash.
pub(crate) fn winrt_path(path: &Path) -> HSTRING {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    HSTRING::from(absolute.to_string_lossy().replace('/', "\\"))
}

pub(crate) fn winrt<T>(result: windows::core::Result<T>, what: &str) -> Result<T, String> {
    result.map_err(|e| format!("{what}: {}", e.message()))
}

/// Zielprofil: H.264 in der gewünschten Höhe (nie hochskaliert), höchstens `max_fps`.
pub(crate) fn compressed_profile(source: Option<&MediaEncodingProfile>, height: u32, bitrate: u32, max_fps: u32) -> windows::core::Result<MediaEncodingProfile> {
    let quality = if height >= 1080 { VideoEncodingQuality::HD1080p } else { VideoEncodingQuality::HD720p };
    let profile = MediaEncodingProfile::CreateMp4(quality)?;
    let video = profile.Video()?;

    let (src_w, src_h, src_fps) = source
        .and_then(|p| p.Video().ok())
        .map(|v| {
            let fps = v
                .FrameRate()
                .ok()
                .and_then(|r| Some((r.Numerator().ok()?, r.Denominator().ok()?)))
                .filter(|(_, d)| *d > 0)
                .map(|(n, d)| n / d)
                .unwrap_or(max_fps);
            (v.Width().unwrap_or(0), v.Height().unwrap_or(0), fps)
        })
        .unwrap_or((0, 0, max_fps));

    if src_w > 0 && src_h > 0 {
        let h = height.min(src_h) & !1;
        let w = ((src_w as f64 * h as f64 / src_h as f64).round() as u32) & !1;
        video.SetWidth(w)?;
        video.SetHeight(h)?;
    }
    video.SetBitrate(bitrate)?;
    let rate = video.FrameRate()?;
    rate.SetNumerator(src_fps.clamp(1, max_fps))?;
    rate.SetDenominator(1)?;
    if let Ok(audio) = profile.Audio() {
        audio.SetBitrate(128_000)?;
    }
    Ok(profile)
}

/// Wandelt `source` nach `job` um und legt das Ergebnis in `out_dir` ab.
pub fn convert(source: &Path, out_dir: &Path, job: Job, on_progress: impl Fn(f64) + Send + 'static) -> Result<PathBuf, String> {
    if let Some((start, end)) = job.range {
        if !(start >= 0.0 && end > start && end <= job.duration + 0.5) {
            return Err("Ungültiger Ausschnitt".into());
        }
    }
    // WinRT braucht eine initialisierte COM-Umgebung im aufrufenden Thread.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
    // Eindeutig je Lauf: Ein anderer Ausschnitt darf nie das Upload-Ticket eines früheren erben.
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let name = format!("{stem}-{stamp}-fib.mp4");

    let input = winrt(StorageFile::GetFileFromPathAsync(&winrt_path(source)).and_then(|op| op.join()), "Clip öffnen")?;
    let folder = winrt(StorageFolder::GetFolderFromPathAsync(&winrt_path(out_dir)).and_then(|op| op.join()), "Zielordner")?;
    let output = winrt(
        folder.CreateFileAsync(&HSTRING::from(name.as_str()), CreationCollisionOption::ReplaceExisting).and_then(|op| op.join()),
        "Zieldatei anlegen",
    )?;

    let transcoder = winrt(MediaTranscoder::new(), "Transcoder")?;
    winrt(transcoder.SetHardwareAccelerationEnabled(true), "Hardwarebeschleunigung")?;
    if let Some((start, end)) = job.range {
        winrt(transcoder.SetTrimStartTime(span(start)), "Startzeit")?;
        // TrimStopTime ist die Endposition in der Quelle (per Test geprüft, siehe unten).
        winrt(transcoder.SetTrimStopTime(span(end)), "Endzeit")?;
    }

    let source_profile = MediaEncodingProfile::CreateFromFileAsync(&input).and_then(|op| op.join()).ok();
    let candidates: Vec<MediaEncodingProfile> = match job.quality.target() {
        Some((height, bitrate)) => vec![winrt(compressed_profile(source_profile.as_ref(), height, bitrate, MAX_FPS), "Zielprofil")?],
        // Nur schneiden: im Format der Quelle, sonst H.264 als Rückfall.
        None => [source_profile, MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD1080p).ok()].into_iter().flatten().collect(),
    };

    let mut prepared = None;
    for profile in &candidates {
        let result = winrt(transcoder.PrepareFileTranscodeAsync(&input, &output, profile).and_then(|op| op.join()), "Vorbereiten")?;
        if winrt(result.CanTranscode(), "Vorbereiten")? {
            prepared = Some(result);
            break;
        }
    }
    let prepared = prepared.ok_or("Windows kann diesen Clip nicht umwandeln (Format nicht unterstützt)")?;

    let operation = winrt(prepared.TranscodeAsync(), "Umwandeln")?;
    winrt(
        operation.SetProgress(&AsyncActionProgressHandler::new(move |_, percent: windows_core::Ref<f64>| {
            on_progress(*percent);
            Ok(())
        })),
        "Fortschritt",
    )?;
    winrt(operation.join(), "Umwandeln")?;
    Ok(PathBuf::from(output.Path().map_err(|e| e.message())?.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_source(dir: &Path) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let source = dir.join("quelle.mp4");
        let ok = std::process::Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60"])
            .args(["-f", "lavfi", "-i", "sine=frequency=440", "-t", "20", "-c:v", "libx264", "-b:v", "20M", "-pix_fmt", "yuv420p", "-c:a", "aac"])
            .arg(&source)
            .status()
            .unwrap();
        assert!(ok.success());
        source
    }

    fn probe(file: &Path) -> String {
        let out = std::process::Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "compact"])
            .arg(file)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn duration_of(text: &str) -> f64 {
        text.lines()
            .find_map(|l| l.strip_prefix("format|"))
            .and_then(|l| l.split('|').find_map(|kv| kv.strip_prefix("duration=")))
            .unwrap()
            .parse()
            .unwrap()
    }

    /// Braucht ffmpeg/ffprobe im PATH (nur für Testvideo und Prüfung): `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn trims_only() {
        let dir = std::env::temp_dir().join("fib-convert-trim");
        let source = make_source(&dir);
        let job = Job { range: Some((4.0, 11.5)), duration: 20.0, quality: Quality::Original };
        let out = convert(&source, &dir.join("out"), job, |_| {}).unwrap();
        let info = probe(&out);
        println!("{info}");
        assert!((duration_of(&info) - 7.5).abs() < 0.3);
        assert!(info.contains("codec_type=audio"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore]
    fn trims_and_compresses_to_720p30() {
        let dir = std::env::temp_dir().join("fib-convert-720");
        let source = make_source(&dir);
        let started = std::time::Instant::now();
        let job = Job { range: Some((2.0, 17.0)), duration: 20.0, quality: Quality::P720 };
        let out = convert(&source, &dir.join("out"), job, |_| {}).unwrap();
        let info = probe(&out);
        println!("Dauer {:?}\nQuelle: {}\nErgebnis: {info}", started.elapsed(), probe(&source));
        assert!((duration_of(&info) - 15.0).abs() < 0.3);
        assert!(info.contains("codec_name=h264") && info.contains("width=1280") && info.contains("height=720"));
        assert!(info.contains("avg_frame_rate=30/1"), "nicht 30 fps");
        assert!(std::fs::metadata(&out).unwrap().len() < std::fs::metadata(&source).unwrap().len());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
