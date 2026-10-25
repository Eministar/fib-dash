//! Rendert die geplanten Ausschnitte eines Clips zu einem Video: mehrere
//! Stücke derselben Aufnahme hintereinander (Windows.Media.Editing), mit der
//! Bitrate aus dem Plan – so bleibt die Datei sicher unter dem Discord-Limit.
//! Läuft über den Hardware-Encoder der Grafikkarte.

use std::path::{Path, PathBuf};

use windows::{
    core::HSTRING,
    Media::{
        Editing::{MediaClip, MediaComposition, MediaTrimmingPreference},
        MediaProperties::MediaEncodingProfile,
        Transcoding::TranscodeFailureReason,
    },
    Storage::{CreationCollisionOption, StorageFile, StorageFolder},
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

use super::plan::Output;
use crate::convert::{compressed_profile, span, winrt, winrt_path};

/// Medal legt mehrere Tonspuren ab (Gesamt, Spiel, Mikrofon, Discord …), und Windows
/// nimmt sonst die erste – bei Medal eine fast stumme Nebenspur. Die Spur mit der
/// höchsten Bitrate ist die volle (Spiel bzw. Gesamtmischung); stille Spuren kodiert AAC klein.
fn select_game_audio(clip: &MediaClip) {
    let Ok(tracks) = clip.EmbeddedAudioTracks() else { return };
    let best = tracks
        .into_iter()
        .enumerate()
        .max_by_key(|(_, track)| track.GetAudioEncodingProperties().and_then(|p| p.Bitrate()).unwrap_or(0))
        .map(|(index, _)| index as u32);
    if let Some(index) = best {
        let _ = clip.SetSelectedEmbeddedAudioTrackIndex(index);
    }
}

pub fn render(source: &Path, clip_len: f64, output: &Output, out_dir: &Path, name: &str) -> Result<PathBuf, String> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let input = winrt(StorageFile::GetFileFromPathAsync(&winrt_path(source)).and_then(|op| op.join()), "Clip öffnen")?;
    let folder = winrt(StorageFolder::GetFolderFromPathAsync(&winrt_path(out_dir)).and_then(|op| op.join()), "Zielordner")?;
    let target = winrt(
        folder.CreateFileAsync(&HSTRING::from(name), CreationCollisionOption::GenerateUniqueName).and_then(|op| op.join()),
        "Zieldatei anlegen",
    )?;

    let composition = winrt(MediaComposition::new(), "Schnitt")?;
    let clips = winrt(composition.Clips(), "Schnitt")?;
    for (start, end) in &output.ranges {
        let clip = winrt(MediaClip::CreateFromFileAsync(&input).and_then(|op| op.join()), "Clip laden")?;
        select_game_audio(&clip);
        winrt(clip.SetTrimTimeFromStart(span(*start)), "Startzeit")?;
        winrt(clip.SetTrimTimeFromEnd(span((clip_len - end).max(0.0))), "Endzeit")?;
        winrt(clips.Append(&clip), "Schnitt")?;
    }

    let source_profile = MediaEncodingProfile::CreateFromFileAsync(&input).and_then(|op| op.join()).ok();
    let profile = winrt(compressed_profile(source_profile.as_ref(), output.height, output.video_bitrate, output.fps), "Zielprofil")?;
    let reason = winrt(
        composition
            .RenderToFileWithProfileAsync(&target, MediaTrimmingPreference::Precise, &profile)
            .and_then(|op| op.join()),
        "Rendern",
    )?;
    let path = PathBuf::from(winrt(target.Path(), "Zieldatei")?.to_string());
    if reason != TranscodeFailureReason::None {
        let _ = std::fs::remove_file(&path);
        return Err(format!("Rendern fehlgeschlagen ({reason:?})"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::killclip::plan;

    fn probe(file: &Path) -> String {
        let out = std::process::Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height,avg_frame_rate", "-of", "compact"])
            .arg(file)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// Braucht ffmpeg/ffprobe im PATH: `cargo test -- --ignored renders`.
    #[test]
    #[ignore]
    fn renders_several_kills_into_one_video_under_the_limit() {
        let dir = std::env::temp_dir().join("fib-killclip-render");
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("replay.mp4");
        let ok = std::process::Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60"])
            .args(["-f", "lavfi", "-i", "sine=frequency=440", "-t", "60", "-c:v", "libx264", "-b:v", "30M", "-pix_fmt", "yuv420p", "-c:a", "aac"])
            .arg(&source)
            .status()
            .unwrap();
        assert!(ok.success());

        let limit = 10 * 1024 * 1024;
        let outputs = plan::plan(&[10.0, 12.0, 40.0], 60.0, 3.0, 3.0, limit);
        assert_eq!(outputs.len(), 1);
        let started = std::time::Instant::now();
        let out = render(&source, 60.0, &outputs[0], &dir.join("out"), "kill.mp4").unwrap();
        let info = probe(&out);
        println!("{:?} in {:?}: {info}", outputs[0], started.elapsed());
        let duration: f64 = info
            .lines()
            .find_map(|l| l.strip_prefix("format|"))
            .and_then(|l| l.split('|').find_map(|kv| kv.strip_prefix("duration=")))
            .unwrap()
            .parse()
            .unwrap();
        // (7..15) + (37..43) = 8 s + 6 s
        assert!((duration - 14.0).abs() < 0.4, "{duration}");
        assert!(std::fs::metadata(&out).unwrap().len() < limit);
        assert!(info.contains("codec_type=audio"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod real_clip {
    use super::*;
    use crate::killclip::plan;

    /// Echte Aufnahme (nur lesend) aus `FIB_REAL_CLIP`: drei Kills, Ergebnis in den Temp-Ordner.
    #[test]
    #[ignore]
    fn renders_a_real_replay() {
        let source = PathBuf::from(std::env::var("FIB_REAL_CLIP").expect("FIB_REAL_CLIP setzen"));
        let clip_len = crate::media::duration_seconds(&source).expect("Länge lesbar");
        let limit = 50 * 1024 * 1024;
        let outputs = plan::plan(&[clip_len - 120.0, clip_len - 116.0, clip_len - 30.0], clip_len, 3.0, 3.0, limit);
        let dir = std::env::temp_dir().join("fib-killclip-real");
        let started = std::time::Instant::now();
        let out = render(&source, clip_len, &outputs[0], &dir, "echt.mp4").unwrap();
        let size = std::fs::metadata(&out).unwrap().len();
        println!("{:?}\n→ {} in {:?}, {:.1} MB", outputs[0], out.display(), started.elapsed(), size as f64 / 1048576.0);
        assert!(size < limit);
    }
}

