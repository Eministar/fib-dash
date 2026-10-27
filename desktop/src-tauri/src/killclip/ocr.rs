//! Texterkennung mit der in Windows eingebauten OCR (Windows.Media.Ocr) –
//! offline, ohne Zusatzprogramme. Live wird höchstens ein OCR-Durchlauf pro Scan ausgeführt.

use windows::{
    Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::DataWriter,
};

use super::{
    detect::{events, group_rows, Line, Word},
    screen::Image,
};

pub struct Ocr {
    engine: OcrEngine,
}

// Wird nur im Erkennungs-Thread benutzt.
unsafe impl Send for Ocr {}

/// Kill-Feeds nutzen kleine Schrift – vergrößert erkennt die OCR sie deutlich besser.
const MIN_TEXT_HEIGHT: u32 = 360;

/// Live keine zweite OCR über dasselbe Bild: Die Varianten wechseln zwischen Scans,
/// wenn keine Meldung gelesen wurde. Eine erfolgreiche bleibt für die Bestätigung erhalten.
pub struct LiveFeedOcr {
    ocr: Ocr,
    variant: usize,
    retry_pending: bool,
}

/// (Helligkeitsschwelle, Vergrößerung) – live kommt das Bild pixelscharf vom Spiel.
/// Gemessen an echten Ausschnitten (`ocr_variants_on_saved_crops`): 170/4× liest Namen
/// am besten, 160/3× macht andere Fehler und fängt auf, was 170/4× nicht liest.
const LIVE_VARIANTS: [(u8, u32); 2] = [(170, 4), (160, 3)];

impl LiveFeedOcr {
    pub fn new() -> Result<Self, String> {
        Ok(Self { ocr: Ocr::new()?, variant: 0, retry_pending: false })
    }

    pub fn needs_retry(&self) -> bool {
        self.retry_pending
    }

    pub fn read(&mut self, image: &Image) -> Result<Vec<Line>, String> {
        let (threshold, scale) = LIVE_VARIANTS[self.variant];
        let prepared = Image { width: image.width, height: image.height, bgra: super::pixels::threshold_bgra(&image.bgra, threshold) };
        let lines = self.ocr.read_with(&prepared, scale, false)?;
        if events(&lines).is_empty() {
            self.variant = (self.variant + 1) % LIVE_VARIANTS.len();
            self.retry_pending = !self.retry_pending;
        } else {
            self.retry_pending = false;
        }
        Ok(lines)
    }
}

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

    /// Einrichtung mit denselben Schwellen wie live prüfen. Für komprimierte,
    /// halb durchsichtige Replay-Schrift zusätzlich Graustufen versuchen.
    pub fn read_feed(&self, image: &Image) -> Result<Vec<Line>, String> {
        for (threshold, scale) in LIVE_VARIANTS {
            let prepared = Image { width: image.width, height: image.height, bgra: super::pixels::threshold_bgra(&image.bgra, threshold) };
            let lines = self.read_with(&prepared, scale, false)?;
            if !events(&lines).is_empty() {
                return Ok(lines);
            }
        }
        let first = self.read(image)?;
        if !events(&first).is_empty() {
            return Ok(first);
        }
        match self.read_with(image, 3, false) {
            Ok(closer) if !events(&closer).is_empty() => Ok(closer),
            _ => Ok(first),
        }
    }

    /// Wie `read`, mit wählbarer Vergrößerung und optional invertiert (dunkle Schrift auf hell).
    pub fn read_with(&self, image: &Image, scale: u32, invert: bool) -> Result<Vec<Line>, String> {
        let max = OcrEngine::MaxImageDimension().unwrap_or(2600);
        if image.width == 0 || image.height == 0 || scale == 0 || image.width > max || image.height > max {
            return Err("Kill-Feed-Bereich ist zu groß".into());
        }
        // Vor dem Vergrößern begrenzen: früher wurden auch unbrauchbare 3×-Bilder
        // vollständig berechnet und erst danach wegen Übergröße verworfen.
        let scale = scale.min(max / image.width).min(max / image.height);
        let prepared = Image {
            width: image.width * scale,
            height: image.height * scale,
            bgra: super::pixels::prepare_bgra(&image.bgra, image.width as usize, image.height as usize, scale, invert),
        };
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
