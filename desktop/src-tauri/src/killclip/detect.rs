//! Kill-Erkennung aus dem Bild – ohne das Spiel anzufassen.
//!
//! * Kill-Feed (NERO-V): Benachrichtigungen „Du hast <Name> getötet“ (eigener Kill)
//!   und „Du wurdest von <Name> getötet“ (eigener Tod). Gelesen per Texterkennung;
//!   nur Kills lösen einen Clip aus, der Name wird übernommen.
//! * Kill-Marker: Nach einem Kill erscheint um das Fadenkreuz ein türkises „X“.
//!   Erkannt an Farbe, Form und plötzlichem Auftauchen – als zweites Signal.
//!
//! Hier steckt nur Logik ohne Windows-Aufrufe, damit sie testbar bleibt.

/// Ein erkanntes Wort mit seiner Lage im Bereich.
#[derive(Clone, Debug)]
pub struct Word {
    pub text: String,
    pub x0: f32,
    pub y0: f32,
    pub y1: f32,
}

#[derive(Clone, Debug, Default)]
pub struct Line {
    pub words: Vec<Word>,
}

impl Line {
    pub fn text(&self) -> String {
        self.words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ")
    }
}

/// Ordnet Wörter zu Bildschirmzeilen (die Windows-OCR trennt sonst bei großen Lücken).
pub fn group_rows(mut words: Vec<Word>) -> Vec<Line> {
    words.sort_by(|a, b| ((a.y0 + a.y1) / 2.0).total_cmp(&((b.y0 + b.y1) / 2.0)));
    let mut rows: Vec<Line> = Vec::new();
    for word in words {
        let center = (word.y0 + word.y1) / 2.0;
        let fits = rows.last().is_some_and(|row| {
            let top = row.words.iter().map(|w| w.y0).fold(f32::MAX, f32::min);
            let bottom = row.words.iter().map(|w| w.y1).fold(f32::MIN, f32::max);
            center >= top && center <= bottom
        });
        if fits {
            rows.last_mut().unwrap().words.push(word);
        } else {
            rows.push(Line { words: vec![word] });
        }
    }
    for row in &mut rows {
        row.words.sort_by(|a, b| a.x0.total_cmp(&b.x0));
    }
    rows
}

/// Kleinbuchstaben, Umlaute aufgelöst, nur Buchstaben und Ziffern – OCR liefert gern Rauschen.
pub fn fold(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .flat_map(|c| match c {
            'ä' => vec!['a'],
            'ö' => vec!['o'],
            'ü' => vec!['u'],
            'ß' => vec!['s', 's'],
            c if c.is_alphanumeric() => vec![c],
            _ => vec![],
        })
        .collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            cur[j + 1] = (prev[j] + usize::from(ca != *cb)).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[b.len()]
}

fn similarity(a: &str, b: &str) -> f32 {
    let longest = a.chars().count().max(b.chars().count());
    if longest == 0 {
        return 1.0;
    }
    1.0 - levenshtein(a, b) as f32 / longest as f32
}

/// Ist das Wort (mit OCR-Fehlern) eines der Zielwörter?
fn word_is(word: &str, targets: &[&str], max_edits: usize) -> bool {
    let w = fold(word);
    !w.is_empty() && targets.iter().any(|t| levenshtein(&w, t) <= max_edits)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FeedEvent {
    /// „Du hast <Name> getötet“
    Kill(String),
    /// „Du wurdest von <Name> getötet“
    Death(String),
}

/// Liest eine Kill-Feed-Zeile. Der Name bleibt so, wie er im Spiel steht.
pub fn classify(line: &Line) -> Option<FeedEvent> {
    let words: Vec<&str> = line.words.iter().map(|w| w.text.as_str()).collect();
    // „getötet“ – auch als „getotet“, „get6tet“ o. Ä. gelesen.
    let end = words.iter().rposition(|w| word_is(w, &["getotet", "getoetet"], 2))?;
    let du = words[..end].iter().position(|w| word_is(w, &["du"], 0))?;
    let next = words.get(du + 1)?;
    let (kind, start) = if word_is(next, &["hast"], 1) {
        ("kill", du + 2)
    } else if word_is(next, &["wurdest"], 2) {
        // „von“ überspringen, falls gelesen.
        let after = if words.get(du + 2).is_some_and(|w| word_is(w, &["von"], 1)) { du + 3 } else { du + 2 };
        ("death", after)
    } else {
        return None;
    };
    if start >= end {
        return None;
    }
    let name = clean_name(&words[start..end].join(" "));
    if name.is_empty() {
        return None;
    }
    Some(if kind == "kill" { FeedEvent::Kill(name) } else { FeedEvent::Death(name) })
}

/// Typische OCR-Verwechslungen in Namen wie „NV | Aki | FIB [865]“ bereinigen.
fn clean_name(raw: &str) -> String {
    let spaced: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    spaced
        .split(' ')
        // Ein einzelnes „I“, „l“, „1“ oder „!“ zwischen Namensteilen ist der Trennstrich.
        .map(|part| if matches!(part, "I" | "l" | "1" | "!" | "¦") { "|".to_string() } else { repair_brackets(part) })
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c == ',' || c == '.' || c == ':')
        .to_string()
}

/// „1865]“ oder „l865]“ → „[865]“: Die OCR liest die eckige Klammer gern als 1/l/I.
fn repair_brackets(part: &str) -> String {
    let mut chars: Vec<char> = part.chars().collect();
    if chars.len() >= 3 && chars.last() == Some(&']') && !chars.contains(&'[') && matches!(chars[0], '1' | 'l' | 'I' | '(' | '{') {
        chars[0] = '[';
    }
    chars.into_iter().collect()
}

/// Merkt sich, welche Meldungen gerade zu sehen sind, und meldet nur neue.
pub struct KillfeedTracker {
    /// (Art + gefalteter Name, zuletzt gesehen in Sekunden)
    visible: Vec<(String, f64)>,
    /// So lange darf eine Meldung fehlen (Einblenden, OCR-Aussetzer), ohne als neu zu gelten.
    forget_after: f64,
}

impl Default for KillfeedTracker {
    fn default() -> Self {
        Self { visible: Vec::new(), forget_after: 2.5 }
    }
}

impl KillfeedTracker {
    /// Neue Kills und Tode in diesem OCR-Ergebnis.
    pub fn update(&mut self, lines: &[Line], now: f64) -> Vec<FeedEvent> {
        self.visible.retain(|(_, seen)| now - *seen <= self.forget_after);
        let mut events = Vec::new();
        for event in lines.iter().filter_map(classify) {
            let key = match &event {
                FeedEvent::Kill(name) => format!("k:{}", fold(name)),
                FeedEvent::Death(name) => format!("d:{}", fold(name)),
            };
            match self.visible.iter_mut().find(|(known, _)| known[..2] == key[..2] && similarity(known, &key) >= 0.75) {
                Some(entry) => entry.1 = now,
                None => {
                    self.visible.push((key, now));
                    events.push(event);
                }
            }
        }
        events
    }
}

// ── Türkiser Kill-Marker ─────────────────────────────────────────────

/// Türkis wie der NERO-V-Kill-Marker (Farbton ~185°), kräftig genug, um sich
/// vom grünlich-dunklen Spielhintergrund abzuheben.
pub fn is_marker_color(r: u8, g: u8, b: u8) -> bool {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    if max < 0.38 || delta / max.max(1e-6) < 0.5 {
        return false;
    }
    let hue = if max == r {
        60.0 * (((g - b) / delta) % 6.0)
    } else if max == g {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };
    let hue = if hue < 0.0 { hue + 360.0 } else { hue };
    (176.0..=208.0).contains(&hue)
}

/// Maske der türkisen Pixel eines BGRA-Ausschnitts.
pub fn marker_mask(bgra: &[u8]) -> Vec<bool> {
    bgra.chunks_exact(4).map(|p| is_marker_color(p[2], p[1], p[0])).collect()
}

/// Wie sehr der Ausschnitt dem Marker gleicht (0..1).
///
/// Mit Vorlage (bei der Einrichtung aufgenommen): Überlappung der Masken.
/// Ohne: ein „X“ aus vier diagonalen Strichen um die Mitte – mindestens drei
/// Arme müssen da sein, und außerhalb der Diagonalen darf kaum Türkis sein
/// (sonst ist es Himmel oder Wasser, kein Marker).
pub fn marker_score(mask: &[bool], width: usize, height: usize, template: Option<&[bool]>) -> f32 {
    if let Some(template) = template.filter(|t| t.len() == mask.len()) {
        let both = mask.iter().zip(template).filter(|(a, b)| **a && **b).count();
        let either = mask.iter().zip(template).filter(|(a, b)| **a || **b).count();
        return if either == 0 { 0.0 } else { both as f32 / either as f32 };
    }
    let scale = width.min(height) as f32 / 64.0;
    let (cx, cy) = (width as f32 / 2.0, height as f32 / 2.0);
    let (r_in, r_out, band) = (5.0 * scale, 30.0 * scale, 2.5 * scale);
    let mut arm_hits = [0usize; 4];
    let mut arm_size = [0usize; 4];
    let mut outside = 0usize;
    let mut outside_area = 0usize;
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            let r = (dx * dx + dy * dy).sqrt();
            if r < r_in || r > r_out {
                continue;
            }
            let on_diagonal = (dx.abs() - dy.abs()).abs() <= band;
            let quadrant = usize::from(dx > 0.0) + 2 * usize::from(dy > 0.0);
            let hit = mask[y * width + x];
            if on_diagonal {
                arm_size[quadrant] += 1;
                arm_hits[quadrant] += usize::from(hit);
            } else {
                outside_area += 1;
                outside += usize::from(hit);
            }
        }
    }
    let mut coverage: Vec<f32> = (0..4).map(|q| arm_hits[q] as f32 / arm_size[q].max(1) as f32).collect();
    coverage.sort_by(|a, b| b.total_cmp(a));
    // Wie viel der Fläche neben den Diagonalen ebenfalls türkis ist (Himmel, Wasser …).
    let spill = outside as f32 / outside_area.max(1) as f32;
    // Drittstärkster Arm: verlangt mindestens drei Arme.
    coverage[2] * (1.0 - spill).powi(4)
}

/// Meldet einen Marker, sobald die Ähnlichkeit über die Schwelle steigt.
pub struct HitmarkerTracker {
    active: bool,
    last_event: f64,
    pub threshold: f32,
}

impl HitmarkerTracker {
    pub fn new(threshold: f32) -> Self {
        Self { active: false, last_event: f64::MIN, threshold }
    }

    pub fn update(&mut self, score: f32, now: f64) -> bool {
        let above = score >= self.threshold;
        let rising = above && !self.active;
        // Abfallen erst deutlich unter der Schwelle (Hysterese gegen Flackern).
        self.active = if self.active { score >= self.threshold * 0.6 } else { above };
        if rising && now - self.last_event >= 0.8 {
            self.last_event = now;
            return true;
        }
        false
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Source {
    Killfeed,
    Hitmarker,
}

/// Führt beide Quellen zusammen: Derselbe Kill erscheint als Marker und kurz
/// darauf im Kill-Feed – das zählt nur einmal.
#[derive(Default)]
pub struct KillMerger {
    recent: Vec<(Source, f64)>,
}

impl KillMerger {
    pub fn accept(&mut self, source: Source, now: f64) -> bool {
        self.recent.retain(|(_, t)| now - *t < 3.0);
        let duplicate = self.recent.iter().any(|(s, t)| *s != source && (now - *t).abs() <= 2.0);
        self.recent.push((source, now));
        if duplicate {
            if let Some(pos) = self.recent.iter().position(|(s, t)| *s != source && (now - *t).abs() <= 2.0) {
                self.recent.remove(pos);
            }
            self.recent.pop();
        }
        !duplicate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str) -> Line {
        Line {
            words: text
                .split_whitespace()
                .enumerate()
                .map(|(i, t)| Word { text: t.to_string(), x0: i as f32 * 50.0, y0: 0.0, y1: 20.0 })
                .collect(),
        }
    }

    #[test]
    fn kill_and_death_are_told_apart_with_names() {
        assert_eq!(classify(&line("Du hast NV | Aki | FIB [865] getötet")), Some(FeedEvent::Kill("NV | Aki | FIB [865]".into())));
        assert_eq!(classify(&line("Du wurdest von NV | Aki | FIB [865] getötet")), Some(FeedEvent::Death("NV | Aki | FIB [865]".into())));
        assert_eq!(classify(&line("SYSTEM SUCCESS")), None);
        assert_eq!(classify(&line("Du hast 5000$ erhalten")), None);
    }

    #[test]
    fn tolerates_typical_ocr_errors() {
        // „ö“ als „o“, „|“ als „I“, „getötet“ als „get6tet“.
        assert_eq!(classify(&line("Du hast NV I Aki I FIB [865] getotet")), Some(FeedEvent::Kill("NV | Aki | FIB [865]".into())));
        assert_eq!(classify(&line("Du hast Max_Muster get6tet")), Some(FeedEvent::Kill("Max_Muster".into())));
        assert_eq!(classify(&line("Du hast NV I Aki I FIB 1865] getÄTtet")), Some(FeedEvent::Kill("NV | Aki | FIB [865]".into())));
        assert_eq!(classify(&line("Du wurdst von Max_Muster getötet")), Some(FeedEvent::Death("Max_Muster".into())));
        // Ein Tod wird nie als Kill gewertet, auch wenn „hast“ fehlt.
        assert!(!matches!(classify(&line("Du wurdest von Du hast getötet")), Some(FeedEvent::Kill(_))));
    }

    #[test]
    fn same_notification_counts_once_until_it_disappears() {
        let mut t = KillfeedTracker::default();
        let kill = line("Du hast NV | Aki | FIB [865] getötet");
        assert_eq!(t.update(&[kill.clone()], 0.0).len(), 1);
        assert_eq!(t.update(&[kill.clone()], 0.5).len(), 0);
        // OCR liest dieselbe Meldung leicht anders → kein neuer Kill.
        assert_eq!(t.update(&[line("Du hast NV I Aki | FIB [865] getotet")], 1.0).len(), 0);
        // Tod desselben Spielers ist ein eigenes Ereignis.
        assert_eq!(t.update(&[line("Du wurdest von NV | Aki | FIB [865] getötet")], 1.2), vec![FeedEvent::Death("NV | Aki | FIB [865]".into())]);
        // Weg und wieder da → neuer Kill.
        assert_eq!(t.update(&[], 6.0).len(), 0);
        assert_eq!(t.update(&[kill], 6.5).len(), 1);
    }

    /// Ausschnitt mit dunkelgrünlichem Spielhintergrund wie im Screenshot.
    fn background(size: usize) -> Vec<u8> {
        (0..size * size).flat_map(|_| [79u8, 84, 44, 255]).collect()
    }

    fn paint(bgra: &mut [u8], size: usize, x: usize, y: usize) {
        let i = (y * size + x) * 4;
        bgra[i..i + 4].copy_from_slice(&[116, 104, 40, 255]); // BGRA, Türkis (40, 104, 116)
    }

    fn with_x(size: usize) -> Vec<u8> {
        let mut img = background(size);
        let c = size / 2;
        for d in 8..26 {
            for t in 0..2 {
                paint(&mut img, size, c + d + t, c + d);
                paint(&mut img, size, c - d - t, c + d);
                paint(&mut img, size, c + d + t, c - d);
                paint(&mut img, size, c - d - t, c - d);
            }
        }
        img
    }

    #[test]
    fn turquoise_marker_is_found_but_not_background_or_sky() {
        let size = 64;
        assert!(!is_marker_color(44, 84, 79), "grünlicher Hintergrund ist kein Marker");
        assert!(is_marker_color(40, 104, 116));
        let marker = marker_score(&marker_mask(&with_x(size)), size, size, None);
        let empty = marker_score(&marker_mask(&background(size)), size, size, None);
        let sky: Vec<u8> = (0..size * size).flat_map(|_| [116u8, 104, 40, 255]).collect();
        let sky = marker_score(&marker_mask(&sky), size, size, None);
        println!("Marker {marker}, Hintergrund {empty}, Fläche {sky}");
        assert!(marker > 0.25, "Marker {marker}");
        assert!(empty < 0.01, "Hintergrund {empty}");
        assert!(sky < 0.05, "türkise Fläche {sky}");
        // Mit angelernter Vorlage: Überlappung.
        let template = marker_mask(&with_x(size));
        assert!(marker_score(&marker_mask(&with_x(size)), size, size, Some(&template)) > 0.99);
    }

    #[test]
    fn marker_fires_once_per_appearance() {
        let mut h = HitmarkerTracker::new(0.25);
        assert!(h.update(0.5, 0.0));
        assert!(!h.update(0.45, 0.1));
        assert!(!h.update(0.2, 0.2)); // Hysterese: noch aktiv
        assert!(!h.update(0.0, 0.3));
        assert!(h.update(0.5, 1.5));
    }

    #[test]
    fn marker_and_feed_for_the_same_kill_count_once() {
        let mut m = KillMerger::default();
        assert!(m.accept(Source::Hitmarker, 10.0));
        assert!(!m.accept(Source::Killfeed, 10.6));
        assert!(m.accept(Source::Hitmarker, 11.2));
        assert!(!m.accept(Source::Killfeed, 11.9));
        assert!(m.accept(Source::Killfeed, 20.0));
        assert!(m.accept(Source::Killfeed, 20.4));
    }
}
