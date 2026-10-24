//! Kill-Erkennung aus dem Bild – ohne das Spiel anzufassen.
//!
//! * Kill-Feed: Texterkennung im festgelegten Bereich. Ein Kill ist eine neue
//!   Zeile, in der der eigene Name links (= als Täter) steht.
//! * Hitmarker: Vergleich eines kleinen Bildausschnitts in der Bildmitte mit
//!   einer bei der Einrichtung gespeicherten Vorlage.
//!
//! Hier steckt nur Logik ohne Windows-Aufrufe, damit sie testbar bleibt.

/// Ein erkanntes Wort mit seiner horizontalen Lage im Bereich.
#[derive(Clone, Debug)]
pub struct Word {
    pub text: String,
    pub x0: f32,
    pub x1: f32,
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

/// Ordnet Wörter zu Bildschirmzeilen. Die Windows-OCR fasst Wörter mit großen
/// Lücken (Täter · Waffe · Opfer) sonst spaltenweise zusammen.
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

/// Kleinbuchstaben, nur Buchstaben und Ziffern – OCR liefert gern Satzzeichen-Rauschen.
pub fn normalize(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
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

/// Ähnlichkeit 0..1 zweier normalisierter Texte.
fn similarity(a: &str, b: &str) -> f32 {
    let longest = a.chars().count().max(b.chars().count());
    if longest == 0 {
        return 1.0;
    }
    1.0 - levenshtein(a, b) as f32 / longest as f32
}

/// Passt ein OCR-Wort (oder ein Teil davon) zum eigenen Namen? Kleine OCR-Fehler sind erlaubt.
pub fn name_matches(word: &str, name: &str) -> bool {
    let (word, name) = (normalize(word), normalize(name));
    if name.len() < 3 || word.len() < 3 {
        return !name.is_empty() && word == name;
    }
    if word.contains(&name) {
        return true;
    }
    let allowed = if name.chars().count() >= 6 { 2 } else { 1 };
    levenshtein(&word, &name) <= allowed
}

/// Steht der eigene Name als Täter in der Zeile? Täter stehen links, Opfer rechts.
/// Mehrteilige Namen („Mike Perez“) werden über alle Wörter hinweg gesucht.
pub fn is_own_kill(line: &Line, name: &str) -> bool {
    if line.words.len() < 2 {
        return false;
    }
    let left = line.words.iter().map(|w| w.x0).fold(f32::MAX, f32::min);
    let right = line.words.iter().map(|w| w.x1).fold(f32::MIN, f32::max);
    let middle = left + (right - left) * 0.5;
    let parts: Vec<&str> = name.split_whitespace().collect();
    let Some(last) = parts.last() else { return false };

    line.words.iter().enumerate().any(|(i, word)| {
        // Ganzer Name in einem Wort oder der Nachname, vor dem die übrigen Namensteile stehen.
        let hit = name_matches(&word.text, name)
            || (parts.len() > 1
                && name_matches(&word.text, last)
                && i + 1 >= parts.len()
                && parts[..parts.len() - 1]
                    .iter()
                    .rev()
                    .zip(line.words[..i].iter().rev())
                    .all(|(p, w)| name_matches(&w.text, p)));
        // Rechts vom Täter muss noch etwas stehen (das Opfer).
        hit && (word.x0 + word.x1) / 2.0 < middle && line.words.iter().any(|w| w.x0 > word.x1)
    })
}

/// Merkt sich, welche Kill-Feed-Zeilen gerade zu sehen sind, und meldet nur neue.
pub struct KillfeedTracker {
    /// (normalisierter Text, zuletzt gesehen in Sekunden)
    visible: Vec<(String, f64)>,
    /// So lange darf eine Zeile fehlen (Flackern, OCR-Aussetzer), ohne als neu zu gelten.
    forget_after: f64,
}

impl Default for KillfeedTracker {
    fn default() -> Self {
        Self { visible: Vec::new(), forget_after: 2.5 }
    }
}

impl KillfeedTracker {
    /// Verarbeitet ein OCR-Ergebnis und liefert die Anzahl neuer eigener Kills.
    pub fn update(&mut self, lines: &[Line], name: &str, now: f64) -> Vec<String> {
        self.visible.retain(|(_, seen)| now - *seen <= self.forget_after);
        let mut new_kills = Vec::new();
        for line in lines.iter().filter(|line| is_own_kill(line, name)) {
            let key = normalize(&line.text());
            match self.visible.iter_mut().find(|(known, _)| similarity(known, &key) >= 0.75) {
                Some(entry) => entry.1 = now,
                None => {
                    self.visible.push((key, now));
                    new_kills.push(line.text());
                }
            }
        }
        new_kills
    }
}

/// Normalisierte Kreuzkorrelation zweier gleich großer Graustufenbilder (−1..1).
pub fn ncc(a: &[u8], b: &[u8]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let n = a.len() as f64;
    let mean_a = a.iter().map(|&v| v as f64).sum::<f64>() / n;
    let mean_b = b.iter().map(|&v| v as f64).sum::<f64>() / n;
    let (mut num, mut den_a, mut den_b) = (0.0, 0.0, 0.0);
    for (&x, &y) in a.iter().zip(b) {
        let (dx, dy) = (x as f64 - mean_a, y as f64 - mean_b);
        num += dx * dy;
        den_a += dx * dx;
        den_b += dy * dy;
    }
    if den_a < 1e-6 || den_b < 1e-6 {
        return 0.0;
    }
    (num / (den_a * den_b).sqrt()) as f32
}

/// Meldet einen Hitmarker, sobald die Ähnlichkeit über die Schwelle steigt.
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
        self.active = if self.active { score >= self.threshold - 0.15 } else { above };
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

/// Führt beide Quellen zusammen: Derselbe Kill erscheint als Hitmarker und
/// kurz darauf im Kill-Feed – das zählt nur einmal.
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
            // Das Gegenstück ist verbraucht – ein zweiter Kill kurz danach zählt wieder.
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

    fn line(words: &[(&str, f32)]) -> Line {
        Line {
            words: words
                .iter()
                .map(|(t, x)| Word { text: t.to_string(), x0: *x, x1: *x + 10.0 * t.len() as f32, y0: 0.0, y1: 20.0 })
                .collect(),
        }
    }

    #[test]
    fn groups_columns_back_into_rows() {
        let w = |t: &str, x: f32, y: f32| Word { text: t.into(), x0: x, x1: x + 50.0, y0: y, y1: y + 18.0 };
        // So liefert die OCR: erst die Täter-Spalte, dann Waffen, dann Opfer.
        let rows = group_rows(vec![
            w("John", 10.0, 10.0), w("Perez", 10.0, 55.0), w("[Pistole]", 200.0, 11.0),
            w("[Karabiner]", 200.0, 56.0), w("Max", 330.0, 9.0), w("Tony_Vagos", 330.0, 54.0),
        ]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].text(), "Perez [Karabiner] Tony_Vagos");
        assert!(is_own_kill(&rows[1], "Perez"));
        assert!(!is_own_kill(&rows[0], "Perez"));
    }

    #[test]
    fn own_kill_when_name_is_left() {
        assert!(is_own_kill(&line(&[("Perez", 0.0), ("[Pistole]", 60.0), ("John_Doe", 160.0)]), "Perez"));
    }

    #[test]
    fn own_death_is_not_a_kill() {
        assert!(!is_own_kill(&line(&[("John_Doe", 0.0), ("[Pistole]", 90.0), ("Perez", 190.0)]), "Perez"));
    }

    #[test]
    fn tolerates_ocr_typos_and_multi_word_names() {
        assert!(is_own_kill(&line(&[("Mike", 0.0), ("Perex", 50.0), ("killed", 110.0), ("Bob", 180.0)]), "Mike Perez"));
        assert!(is_own_kill(&line(&[("[FIB-01]Perez", 0.0), ("Bob", 200.0)]), "Perez"));
        assert!(!is_own_kill(&line(&[("Lopez", 0.0), ("Bob", 80.0)]), "Perez"));
    }

    #[test]
    fn same_feed_line_counts_once_until_it_disappears() {
        let mut t = KillfeedTracker::default();
        let kill = line(&[("Perez", 0.0), ("Bob", 80.0)]);
        assert_eq!(t.update(&[kill.clone()], "Perez", 0.0).len(), 1);
        assert_eq!(t.update(&[kill.clone()], "Perez", 0.5).len(), 0);
        // OCR liest denselben Eintrag leicht anders → kein neuer Kill.
        assert_eq!(t.update(&[line(&[("Perez", 0.0), ("B0b", 80.0)])], "Perez", 1.0).len(), 0);
        // Zweiter Kill an anderem Opfer.
        assert_eq!(t.update(&[kill.clone(), line(&[("Perez", 0.0), ("Alice_Smith", 80.0)])], "Perez", 1.5).len(), 1);
        // Eintrag verschwindet und taucht später wieder auf → neuer Kill.
        assert_eq!(t.update(&[], "Perez", 6.0).len(), 0);
        assert_eq!(t.update(&[kill], "Perez", 6.5).len(), 1);
    }

    #[test]
    fn ncc_finds_the_template() {
        let template: Vec<u8> = (0..64).map(|i| if i % 9 == 0 { 255 } else { 20 }).collect();
        let noisy: Vec<u8> = template.iter().map(|v| v.saturating_add(10)).collect();
        let other: Vec<u8> = (0..64).map(|i| (i * 37 % 255) as u8).collect();
        assert!(ncc(&template, &noisy) > 0.95);
        assert!(ncc(&template, &other) < 0.5);
    }

    #[test]
    fn hitmarker_fires_once_per_appearance() {
        let mut h = HitmarkerTracker::new(0.7);
        assert!(h.update(0.9, 0.0));
        assert!(!h.update(0.88, 0.1));
        assert!(!h.update(0.65, 0.2)); // Hysterese: noch aktiv
        assert!(!h.update(0.2, 0.3));
        assert!(h.update(0.9, 1.5));
    }

    #[test]
    fn hitmarker_and_feed_for_the_same_kill_count_once() {
        let mut m = KillMerger::default();
        assert!(m.accept(Source::Hitmarker, 10.0));
        assert!(!m.accept(Source::Killfeed, 10.6));
        // Zweiter Kill: wieder beide Signale.
        assert!(m.accept(Source::Hitmarker, 11.2));
        assert!(!m.accept(Source::Killfeed, 11.9));
        // Zwei schnelle Kills nur im Feed zählen beide.
        assert!(m.accept(Source::Killfeed, 20.0));
        assert!(m.accept(Source::Killfeed, 20.4));
    }
}
