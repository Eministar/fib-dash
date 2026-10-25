//! Einrichtung aus einer Aufnahme: Man markiert in einem gespeicherten Replay den
//! Moment des Kills, die App sieht sich die Bilder um diesen Moment an und findet
//! selbst, wo die Meldung „Du hast … getötet“ steht und wie der Kill-Marker aussieht.
//!
//! Bilder liest Windows.Media.Editing aus dem Video – ohne ffmpeg, in der Größe des
//! Monitors, damit die Bereiche danach direkt für die Live-Erkennung passen.

use std::path::Path;

use serde::Serialize;
use windows_collections::{IIterable, IVectorView};
use windows::{
    Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, ImageStream},
    Media::Editing::{MediaClip, MediaComposition, VideoFramePrecision},
    Storage::{
        StorageFile,
        Streams::{Buffer, DataReader},
    },
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

use super::{
    center_region,
    detect::{self, FeedEvent, Line},
    ocr::Ocr,
    screen::{self, Image, Region},
};
use crate::convert::{span, winrt, winrt_path};

/// Liest einzelne Bilder aus einem Video.
struct Frames {
    composition: MediaComposition,
    duration: f64,
    width: i32,
    height: i32,
}

impl Frames {
    fn open(path: &Path, width: u32, height: u32) -> Result<Self, String> {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let file = winrt(StorageFile::GetFileFromPathAsync(&winrt_path(path)).and_then(|op| op.join()), "Clip öffnen")?;
        let clip = winrt(MediaClip::CreateFromFileAsync(&file).and_then(|op| op.join()), "Clip laden")?;
        let duration = winrt(clip.OriginalDuration(), "Länge")?.Duration as f64 / 10_000_000.0;
        let composition = winrt(MediaComposition::new(), "Clip")?;
        winrt(composition.Clips().and_then(|clips| clips.Append(&clip)), "Clip")?;
        Ok(Self { composition, duration, width: width as i32, height: height as i32 })
    }

    /// Mehrere Bilder auf einmal (schneller als einzeln). Zeiten außerhalb werden begrenzt.
    fn at(&self, times: &[f64]) -> Result<Vec<Image>, String> {
        let spans: Vec<_> = times.iter().map(|t| span(t.clamp(0.0, (self.duration - 0.05).max(0.0)))).collect();
        let streams: IVectorView<ImageStream> = winrt(
            self.composition
                .GetThumbnailsAsync(&IIterable::from(spans), self.width, self.height, VideoFramePrecision::NearestFrame)
                .and_then(|op| op.join()),
            "Bilder aus dem Clip",
        )?;
        streams.into_iter().map(|stream| decode(&stream)).collect()
    }
}

fn decode(stream: &ImageStream) -> Result<Image, String> {
    let decoder = winrt(BitmapDecoder::CreateAsync(stream).and_then(|op| op.join()), "Bild lesen")?;
    let bitmap = winrt(
        decoder
            .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore)
            .and_then(|op| op.join()),
        "Bild lesen",
    )?;
    let (width, height) = (winrt(bitmap.PixelWidth(), "Bild")? as u32, winrt(bitmap.PixelHeight(), "Bild")? as u32);
    let buffer = winrt(Buffer::Create(width * height * 4), "Bild")?;
    winrt(bitmap.CopyToBuffer(&buffer), "Bild")?;
    let mut bgra = vec![0u8; (width * height * 4) as usize];
    winrt(DataReader::FromBuffer(&buffer).and_then(|reader| reader.ReadBytes(&mut bgra)), "Bild")?;
    Ok(Image { width, height, bgra })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    /// Bild mit der Kill-Meldung (bzw. vom gewählten Moment) – wird zum Einrichtungsbild.
    pub path: String,
    /// Bild mit dem deutlichsten Kill-Marker, falls einer zu sehen war.
    pub marker_path: Option<String>,
    pub width: u32,
    pub height: u32,
    /// Zeitpunkt des Einrichtungsbilds im Clip.
    pub at: f64,
    pub killfeed: Option<Region>,
    /// Name aus „Du hast <Name> getötet“; fehlt, wenn nur „getötet“ lesbar war.
    pub victim: Option<String>,
    /// Text der gefundenen Zeile, so wie die Texterkennung sie liest.
    pub line: Option<String>,
    pub hitmarker: Option<Region>,
    pub marker_score: f32,
}

/// Ab diesem Wert gilt ein Marker als sicher gesehen (wie im Probelauf).
const MARKER_SEEN: f32 = 0.2;

/// Texterkennung über das ganze Bild: in überlappenden Kacheln, vergrößert – die
/// Schrift im Kill-Feed ist klein, und eine Meldung darf an keiner Kachelgrenze zerfallen.
fn read_everywhere(ocr: &Ocr, image: &Image) -> Vec<(Line, u32, u32)> {
    let (tile_w, tile_h) = (image.width / 2, image.height / 2);
    let max = windows::Media::Ocr::OcrEngine::MaxImageDimension().unwrap_or(2600);
    let scale = if tile_w * 2 <= max && tile_h * 2 <= max { 2 } else { 1 };
    let mut lines = Vec::new();
    for row in 0..3 {
        for col in 0..3 {
            let (x, y) = (col * image.width / 4, row * image.height / 4);
            let Some(tile) = image.crop(Region { x, y, width: tile_w, height: tile_h }) else { continue };
            for line in ocr.read_with(&tile, scale, false).unwrap_or_default() {
                lines.push((line, x, y));
            }
        }
    }
    lines
}

/// Lage einer Zeile im ganzen Bild.
fn line_box(line: &Line, dx: u32, dy: u32) -> (f32, f32, f32, f32) {
    let x0 = line.words.iter().map(|w| w.x0).fold(f32::MAX, f32::min) + dx as f32;
    let x1 = line.words.iter().map(|w| w.x1).fold(f32::MIN, f32::max) + dx as f32;
    let y0 = line.words.iter().map(|w| w.y0).fold(f32::MAX, f32::min) + dy as f32;
    let y1 = line.words.iter().map(|w| w.y1).fold(f32::MIN, f32::max) + dy as f32;
    (x0, y0, x1, y1)
}

/// Bereich für die Live-Erkennung um die gefundene Zeile: breiter (andere Namen sind
/// länger) und höher (mehrere Meldungen stapeln sich), aber klein genug für die OCR.
fn feed_region(line: (f32, f32, f32, f32), width: u32, height: u32) -> Region {
    let (x0, y0, x1, y1) = line;
    let (w, h) = (x1 - x0, (y1 - y0).max(8.0));
    let pad_x = (w * 0.5).max(h * 6.0);
    let left = (x0 - pad_x).max(0.0);
    let right = (x1 + pad_x).min(width as f32).min(left + 1250.0);
    let top = (y0 - h * 3.0).max(0.0);
    let bottom = (y1 + h * 3.0).min(height as f32);
    Region { x: left as u32, y: top as u32, width: (right - left) as u32, height: (bottom - top) as u32 }
}

/// Sieht sich die Bilder um `at` (Sekunden im Clip) an und findet Kill-Feed und Marker.
pub fn analyze(clip: &Path, at: f64, frame_path: &Path, marker_path: &Path) -> Result<Reference, String> {
    // In Monitorgröße lesen: Bereiche gelten danach genau so für die Live-Erkennung.
    let (width, height) = screen::with_screen(|s| Ok((s.width, s.height))).unwrap_or((1920, 1080));
    let frames = Frames::open(clip, width, height)?;
    let at = at.clamp(0.0, frames.duration);

    // Marker: kurz vor bis kurz nach dem gewählten Moment, in kleinen Schritten.
    let marker_times: Vec<f64> = (-4..=8).map(|i| at + i as f64 * 0.1).collect();
    let marker_frames = frames.at(&marker_times)?;
    let center = center_region(width, height);
    let (marker_index, marker_score) = marker_frames
        .iter()
        .enumerate()
        .map(|(i, frame)| {
            let crop = frame.crop(center);
            let score = crop.map_or(0.0, |c| detect::marker_score(&detect::marker_mask(&c.bgra), c.width as usize, c.height as usize, None));
            (i, score)
        })
        .fold((0, 0.0f32), |best, next| if next.1 > best.1 { next } else { best });
    let marker_seen = marker_score >= MARKER_SEEN;

    // Kill-Feed: Die Meldung erscheint mit dem Kill und bleibt ein paar Sekunden stehen.
    let ocr = Ocr::new()?;
    let start = if marker_seen { marker_times[marker_index] } else { at };
    let feed_times: Vec<f64> = [0.0, 0.3, 0.7, 1.2, 2.0].iter().map(|d| start + d).collect();
    let feed_frames = frames.at(&feed_times)?;
    let mut found: Option<(usize, Region, Option<String>, String)> = None;
    let mut guess: Option<(usize, Region, String)> = None;
    'frames: for (index, frame) in feed_frames.iter().enumerate() {
        for (line, dx, dy) in read_everywhere(&ocr, frame) {
            let region = feed_region(line_box(&line, dx, dy), width, height);
            match detect::classify(&line) {
                Some(FeedEvent::Kill(victim)) => {
                    found = Some((index, region, Some(victim), line.text()));
                    break 'frames;
                }
                // Nur „getötet“ lesbar (z. B. „get&et“): als Vermutung merken.
                None if guess.is_none() && detect::mentions_killed(&line) && !detect::mentions_death(&line) => {
                    guess = Some((index, region, line.text()));
                }
                _ => {}
            }
        }
    }
    let found = found.or(guess.map(|(index, region, text)| (index, region, None, text)));

    // Einrichtungsbild: das mit der Meldung; sonst das mit dem Marker; sonst der gewählte Moment.
    let (image, image_at) = match &found {
        Some((index, ..)) => (&feed_frames[*index], feed_times[*index]),
        None if marker_seen => (&marker_frames[marker_index], marker_times[marker_index]),
        None => (&marker_frames[4], marker_times[4]),
    };
    if let Some(dir) = frame_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    image.save_bmp(frame_path).map_err(|e| e.to_string())?;
    let marker_file = if marker_seen {
        marker_frames[marker_index].save_bmp(marker_path).map_err(|e| e.to_string())?;
        Some(marker_path.display().to_string())
    } else {
        let _ = std::fs::remove_file(marker_path);
        None
    };

    Ok(Reference {
        path: frame_path.display().to_string(),
        marker_path: marker_file,
        width,
        height,
        at: image_at.min(frames.duration),
        killfeed: found.as_ref().map(|(_, region, ..)| *region),
        victim: found.as_ref().and_then(|(_, _, victim, _)| victim.clone()),
        line: found.map(|(.., text)| text),
        hitmarker: marker_seen.then_some(center),
        marker_score,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Echter Clip: `FIB_REFERENCE_CLIP` (Pfad) und `FIB_REFERENCE_AT` (Sekunde des Kills).
    #[test]
    #[ignore]
    fn finds_killfeed_and_marker_in_a_real_clip() {
        let clip = std::env::var("FIB_REFERENCE_CLIP").expect("FIB_REFERENCE_CLIP setzen");
        let at: f64 = std::env::var("FIB_REFERENCE_AT").ok().and_then(|v| v.parse().ok()).unwrap_or(3.0);
        let dir = std::env::temp_dir();
        let started = std::time::Instant::now();
        let result = analyze(Path::new(&clip), at, &dir.join("fib-ref.bmp"), &dir.join("fib-ref-marker.bmp")).unwrap();
        println!("in {:?}: {}", started.elapsed(), serde_json::to_string_pretty(&result).unwrap());
    }
}

