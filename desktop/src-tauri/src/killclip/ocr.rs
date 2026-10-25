//! Texterkennung mit der in Windows eingebauten OCR (Windows.Media.Ocr) –
//! offline, ohne Zusatzprogramme, auf kleinen Ausschnitten in wenigen Millisekunden.

use windows::{
    Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::DataWriter,
};

use super::{
    detect::{classify, group_rows, Line, Word},
    screen::Image,
};

pub struct Ocr {
    engine: OcrEngine,
}

// Wird nur im Erkennungs-Thread benutzt.
unsafe impl Send for Ocr {}

/// Kill-Feeds nutzen kleine Schrift – vergrößert erkennt die OCR sie deutlich besser.
const MIN_TEXT_HEIGHT: u32 = 360;

impl Ocr {
    pub fn new() -> Result<Self, String> {
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|_| "Windows-Texterkennung nicht verfügbar (Sprachpaket fehlt?)".to_string())?;
        Ok(Self { engine })
    }

    /// Erkennt Textzeilen; Wortpositionen beziehen sich auf die Breite des Ausschnitts.
    pub fn read(&self, image: &Image) -> Result<Vec<Line>, String> {
        let scale = if image.height < MIN_TEXT_HEIGHT { 2 } else { 1 };
        self.read_with(image, scale, false)
    }

    /// Für den Kill-Feed: Die Meldung ist dünn und halb durchsichtig. Findet die erste
    /// Lesung keine Meldung, noch einmal stärker vergrößert lesen.
    pub fn read_feed(&self, image: &Image) -> Result<Vec<Line>, String> {
        let first = self.read(image)?;
        if first.iter().any(|line| classify(line).is_some()) || image.height >= MIN_TEXT_HEIGHT {
            return Ok(first);
        }
        match self.read_with(image, 3, false) {
            Ok(closer) if closer.iter().any(|line| classify(line).is_some()) => Ok(closer),
            _ => Ok(first),
        }
    }

    /// Wie `read`, mit wählbarer Vergrößerung und optional invertiert (dunkle Schrift auf hell).
    pub fn read_with(&self, image: &Image, scale: u32, invert: bool) -> Result<Vec<Line>, String> {
        let prepared = prepare(image, scale, invert);
        let max = OcrEngine::MaxImageDimension().unwrap_or(2600);
        if prepared.width > max || prepared.height > max {
            return Err("Kill-Feed-Bereich ist zu groß".into());
        }
        let writer = DataWriter::new().map_err(|e| e.message().to_string())?;
        writer.WriteBytes(&prepared.bgra).map_err(|e| e.message().to_string())?;
        let buffer = writer.DetachBuffer().map_err(|e| e.message().to_string())?;
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            prepared.width as i32,
            prepared.height as i32,
            BitmapAlphaMode::Premultiplied,
        )
        .map_err(|e| e.message().to_string())?;
        let result = self.engine.RecognizeAsync(&bitmap).and_then(|op| op.join()).map_err(|e| e.message().to_string())?;

        let mut words = Vec::new();
        for line in result.Lines().map_err(|e| e.message().to_string())? {
            for word in line.Words().map_err(|e| e.message().to_string())? {
                let rect = word.BoundingRect().map_err(|e| e.message().to_string())?;
                let s = scale as f32;
                words.push(Word {
                    text: word.Text().map(|t| t.to_string()).unwrap_or_default(),
                    x0: rect.X / s,
                    x1: (rect.X + rect.Width) / s,
                    y0: rect.Y / s,
                    y1: (rect.Y + rect.Height) / s,
                });
            }
        }
        Ok(group_rows(words))
    }
}

/// Graustufen mit gestrecktem Kontrast, weich (bilinear) vergrößert – kantige Pixel
/// verschlechtern die Erkennung kleiner Schrift.
fn prepare(image: &Image, scale: u32, invert: bool) -> Image {
    let gray = image.gray();
    let (lo, hi) = gray.iter().fold((255u8, 0u8), |(lo, hi), &v| (lo.min(v), hi.max(v)));
    let range = (hi.saturating_sub(lo)).max(1) as f32;
    let (sw, sh) = (image.width as usize, image.height as usize);
    let at = |x: usize, y: usize| (gray[y.min(sh - 1) * sw + x.min(sw - 1)].saturating_sub(lo)) as f32 * 255.0 / range;

    let (w, h) = (image.width * scale, image.height * scale);
    let mut bgra = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        let fy = ((y as f32 + 0.5) / scale as f32 - 0.5).max(0.0);
        let (y0, ty) = (fy as usize, fy.fract());
        for x in 0..w {
            let fx = ((x as f32 + 0.5) / scale as f32 - 0.5).max(0.0);
            let (x0, tx) = (fx as usize, fx.fract());
            let top = at(x0, y0) * (1.0 - tx) + at(x0 + 1, y0) * tx;
            let bottom = at(x0, y0 + 1) * (1.0 - tx) + at(x0 + 1, y0 + 1) * tx;
            let mut v = (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8;
            if invert {
                v = 255 - v;
            }
            bgra.extend_from_slice(&[v, v, v, 255]);
        }
    }
    Image { width: w, height: h, bgra }
}
