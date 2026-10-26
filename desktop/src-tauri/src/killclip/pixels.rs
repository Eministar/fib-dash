//! OCR-Vorbereitung ohne Windows-Abhängigkeiten, separat mess- und testbar.

/// Kontrastgestreckte Graustufen, bilinear vergrößert. Kontrast und horizontale
/// Koordinaten einmal vorberechnen statt viermal pro Ausgabepixel.
pub fn prepare_bgra(source: &[u8], width: usize, height: usize, scale: u32, invert: bool) -> Vec<u8> {
    assert!(width > 0 && height > 0 && scale > 0);
    assert_eq!(source.len(), width * height * 4);
    let gray: Vec<u8> = source.chunks_exact(4)
        .map(|p| ((p[2] as u32 * 77 + p[1] as u32 * 150 + p[0] as u32 * 29) >> 8) as u8)
        .collect();
    let (lo, hi) = gray.iter().fold((255u8, 0u8), |(lo, hi), &v| (lo.min(v), hi.max(v)));
    let range = hi.saturating_sub(lo).max(1) as f32;
    let normalized: Vec<f32> = gray.iter().map(|v| v.saturating_sub(lo) as f32 * 255.0 / range).collect();
    let (w, h) = (width * scale as usize, height * scale as usize);
    let columns: Vec<_> = (0..w).map(|x| {
        let fx = ((x as f32 + 0.5) / scale as f32 - 0.5).max(0.0);
        let x0 = (fx as usize).min(width - 1);
        (x0, (x0 + 1).min(width - 1), fx.fract())
    }).collect();
    let mut result = vec![0; w * h * 4];
    for (y, row) in result.chunks_exact_mut(w * 4).enumerate() {
        let fy = ((y as f32 + 0.5) / scale as f32 - 0.5).max(0.0);
        let y0 = (fy as usize).min(height - 1);
        let ty = fy.fract();
        let top_row = &normalized[y0 * width..(y0 + 1) * width];
        let y1 = (y0 + 1).min(height - 1);
        let bottom_row = &normalized[y1 * width..(y1 + 1) * width];
        for (pixel, &(x0, x1, tx)) in row.chunks_exact_mut(4).zip(&columns) {
            let top = top_row[x0] * (1.0 - tx) + top_row[x1] * tx;
            let bottom = bottom_row[x0] * (1.0 - tx) + bottom_row[x1] * tx;
            let mut v = (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8;
            if invert { v = 255 - v; }
            pixel.copy_from_slice(&[v, v, v, 255]);
        }
    }
    result
}

/// Schwarz-Weiß nach Helligkeit: heller als `threshold` → weiß, sonst schwarz. Die
/// NERO-V-Meldungen sind weiße Schrift auf dunkler Box; ohne Schwelle las die OCR das
/// pixelscharfe Live-Bild schlecht („DJ hast FB x Rehhard Kdto“), mit Schwelle 160–170
/// fast fehlerfrei („Du hast FIB x Reinhard Kaito“, `ocr_variants_on_saved_crops`).
pub fn threshold_bgra(source: &[u8], threshold: u8) -> Vec<u8> {
    source
        .chunks_exact(4)
        .flat_map(|p| {
            let v = if ((p[2] as u32 * 77 + p[1] as u32 * 150 + p[0] as u32 * 29) >> 8) as u8 > threshold { 255 } else { 0 };
            [v, v, v, 255]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_keeps_bright_text_and_drops_the_dark_box() {
        let pixels = [230, 230, 230, 255, 40, 35, 30, 255, 171, 171, 171, 255, 170, 170, 170, 255];
        assert_eq!(threshold_bgra(&pixels, 170), vec![255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    }

    // Vorheriger Produktionsalgorithmus als Referenz: Die Optimierung darf die
    // Eingabepixel der OCR auch an Kanten und bei Invertierung nicht verändern.
    fn previous(source: &[u8], width: usize, height: usize, scale: u32, invert: bool) -> Vec<u8> {
        let gray: Vec<u8> = source.chunks_exact(4)
            .map(|p| ((p[2] as u32 * 77 + p[1] as u32 * 150 + p[0] as u32 * 29) >> 8) as u8).collect();
        let (lo, hi) = gray.iter().fold((255u8, 0u8), |(lo, hi), &v| (lo.min(v), hi.max(v)));
        let range = hi.saturating_sub(lo).max(1) as f32;
        let at = |x: usize, y: usize| gray[y.min(height - 1) * width + x.min(width - 1)].saturating_sub(lo) as f32 * 255.0 / range;
        let (w, h) = (width * scale as usize, height * scale as usize);
        let mut result = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            let fy = ((y as f32 + 0.5) / scale as f32 - 0.5).max(0.0);
            let (y0, ty) = (fy as usize, fy.fract());
            for x in 0..w {
                let fx = ((x as f32 + 0.5) / scale as f32 - 0.5).max(0.0);
                let (x0, tx) = (fx as usize, fx.fract());
                let top = at(x0, y0) * (1.0 - tx) + at(x0 + 1, y0) * tx;
                let bottom = at(x0, y0 + 1) * (1.0 - tx) + at(x0 + 1, y0 + 1) * tx;
                let mut v = (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8;
                if invert { v = 255 - v; }
                result.extend_from_slice(&[v, v, v, 255]);
            }
        }
        result
    }

    fn fixture(width: usize, height: usize) -> Vec<u8> {
        (0..width * height).flat_map(|i| [(i * 17 % 256) as u8, (i * 37 % 256) as u8, (i * 59 % 256) as u8, 255]).collect()
    }

    #[test]
    fn optimized_pixels_match_previous_ocr_input_exactly() {
        for (w, h) in [(1, 1), (1, 13), (17, 1), (17, 13), (320, 90)] {
            for scale in 1..=4 {
                for invert in [false, true] {
                    for source in [fixture(w, h), vec![80; w * h * 4]] {
                        assert_eq!(prepare_bgra(&source, w, h, scale, invert), previous(&source, w, h, scale, invert), "{w}x{h}, scale={scale}, invert={invert}");
                    }
                }
            }
        }
    }

    /// Lokal mit rustc --test -O ausführen; keine Bildschirmaufnahme notwendig.
    #[test]
    #[ignore]
    fn benchmark_preparation() {
        use std::{hint::black_box, time::Instant};
        let (w, h) = (640, 140);
        let input = fixture(w, h);
        for scale in [2, 3] {
            let old = previous(&input, w, h, scale, false);
            assert_eq!(prepare_bgra(&input, w, h, scale, false), old);
            for (name, run) in [("previous", previous as fn(&[u8], usize, usize, u32, bool) -> Vec<u8>), ("optimized", prepare_bgra)] {
                let started = Instant::now();
                for _ in 0..100 {
                    black_box(run(black_box(&input), w, h, scale, false));
                }
                println!("{name} {w}x{h} scale={scale}: {:.3} ms/scan (100 scans)", started.elapsed().as_secs_f64() * 10.0);
            }
        }
    }
}
