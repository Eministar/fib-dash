//! Kill-Erkennung aus dem Bild – ohne das Spiel anzufassen.
//!
//! * Kill-Feed (NERO-V): Benachrichtigungen „Du hast <Name> getötet“ (eigener Kill)
//!   und „Du wurdest von <Name> getötet“ (eigener Tod). Gelesen per Texterkennung;
//!   nur Kills lösen einen Clip aus, der Name wird übernommen.
//! * Kill-Marker: Nach einem Kill erscheint um das Fadenkreuz ein türkises „X“.
//!   Erkannt an Farbe, Form und kurzem Puls – nur ohne eingerichteten Kill-Feed.
//!
//! Hier steckt nur Logik ohne Windows-Aufrufe, damit sie testbar bleibt.

/// Ein erkanntes Wort mit seiner Lage im Bereich.
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

/// Enthält die Zeile „getötet“? Für die Einrichtung, wenn der Rest unleserlich ist.
pub fn mentions_killed(line: &Line) -> bool {
    line.words.iter().any(|w| word_is(&w.text, &["getotet", "getoetet"], 1))
}

/// Sieht die Zeile nach „Du wurdest von … getötet“ aus (eigener Tod)?
pub fn mentions_death(line: &Line) -> bool {
    line.words.iter().any(|w| word_is(&w.text, &["wurdest"], 2))
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
    // Nur eine vollständige Meldung akzeptieren. Zwei beliebige OCR-Fehler
    // machten auch „getestet“, „gerettet“ und andere Benachrichtigungen zu Kills.
    let end = words.len().checked_sub(1)?;
    if !word_is(words[end], &["getotet", "getoetet"], 1) {
        return None;
    }
    // „Du“ ist kurz und wird gern als „DJ“ gelesen – ein Fehler ist erlaubt; „hast“/„wurdest“
    // direkt danach und „getötet“ am Ende halten die Meldung trotzdem eindeutig.
    let du = words[..end].iter().position(|w| word_is(w, &["du"], 1))?;
    let next = words.get(du + 1)?;
    let (kind, start) = if word_is(next, &["hast"], 0) {
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
    if words[start..end].iter().any(|w| matches!(fold(w).as_str(), "nicht" | "niemanden" | "kein" | "keinen")) {
        return None;
    }
    let name = clean_name(&words[start..end].join(" "));
    if fold(&name).is_empty() {
        return None;
    }
    Some(if kind == "kill" { FeedEvent::Kill(name) } else { FeedEvent::Death(name) })
}

/// Alle Meldungen einer Lesung. Die Box hat eine feste Breite und bricht lange Meldungen
/// um („Du wurdest von FIB x Reinhard Kaito [163“ / „getötet“) – dann gehört die Folgezeile dazu.
pub fn events(lines: &[Line]) -> Vec<FeedEvent> {
    let mut found = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if let Some(event) = classify(&lines[i]) {
            found.push(event);
            i += 1;
            continue;
        }
        if let Some(next) = lines.get(i + 1) {
            let joined = Line { words: lines[i].words.iter().chain(&next.words).cloned().collect() };
            if let Some(event) = classify(&joined) {
                found.push(event);
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    found
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
    visible: Vec<FeedObservation>,
    /// So lange darf eine Meldung fehlen (Einblenden, OCR-Aussetzer), ohne als neu zu gelten.
    forget_after: f64,
}

struct FeedObservation {
    /// Alle Schreibweisen, in denen die OCR diese Meldung bisher gelesen hat.
    keys: Vec<String>,
    first_seen: f64,
    last_seen: f64,
    confirmed: bool,
}

impl Default for KillfeedTracker {
    fn default() -> Self {
        Self { visible: Vec::new(), forget_after: 2.5 }
    }
}

impl KillfeedTracker {
    pub fn needs_confirmation(&self) -> bool {
        self.visible.iter().any(|entry| !entry.confirmed)
    }

    /// Erst zwei zeitlich getrennte Lesungen derselben Meldung bestätigen sie.
    /// Doppelte Zeilen innerhalb einer Lesung zählen nicht als Bestätigung.
    pub fn update(&mut self, lines: &[Line], now: f64) -> Vec<FeedEvent> {
        self.visible.retain(|entry| now - entry.last_seen <= if entry.confirmed { self.forget_after } else { 0.9 });
        let mut confirmed = Vec::new();
        // Jede Meldung einer Lesung gehört zu einer eigenen Beobachtung: Zwei Kills am
        // selben Gegner stehen als zwei gleiche Meldungen untereinander.
        let mut taken = vec![false; self.visible.len()];
        for event in events(lines) {
            let key = match &event {
                FeedEvent::Kill(name) => format!("k:{}", fold(name)),
                FeedEvent::Death(name) => format!("d:{}", fold(name)),
            };
            let found = self.visible.iter().enumerate().position(|(i, entry)| !taken[i] && entry.keys.iter().any(|seen| same_message(seen, &key)));
            match found.map(|i| {
                taken[i] = true;
                &mut self.visible[i]
            }) {
                Some(entry) => {
                    entry.last_seen = now;
                    // Die OCR-Fehler wandern von Lesung zu Lesung („Remard Kaito“ → „Rehhard
                    // Kdto“) – jede Schreibweise merken, sonst zählt dieselbe Meldung doppelt.
                    if entry.keys.len() < 16 && !entry.keys.contains(&key) {
                        entry.keys.push(key);
                    }
                    if !entry.confirmed && now - entry.first_seen >= 0.15 {
                        entry.confirmed = true;
                        confirmed.push(event);
                    }
                }
                None => {
                    self.visible.push(FeedObservation { keys: vec![key], first_seen: now, last_seen: now, confirmed: false });
                    taken.push(true);
                }
            }
        }
        confirmed
    }
}

/// Zwei Lesungen derselben Art (Kill/Tod) zeigen dieselbe Meldung: fast gleich, oder die
/// eine ist ein Stück der anderen (Namensanfang verschluckt: „Salvatore | FIB [730]“).
fn same_message(a: &str, b: &str) -> bool {
    if a[..2] != b[..2] {
        return false;
    }
    let (short, long) = if a.len() <= b.len() { (&a[2..], &b[2..]) } else { (&b[2..], &a[2..]) };
    similarity(a, b) >= 0.85 || (short.chars().count() >= 8 && long.contains(short))
}

// ── Türkiser Kill-Marker ─────────────────────────────────────────────

/// Türkis wie der NERO-V-Kill-Marker (Farbton ~185°), kräftig genug, um sich
/// vom grünlich-dunklen Spielhintergrund abzuheben.
pub fn is_marker_color(r: u8, g: u8, b: u8) -> bool {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    // Aufnahmen und Kantenglättung blassen das Türkis aus (gemessen: 79,130,151 → Sättigung 0,48).
    if max < 0.3 || delta / max.max(1e-6) < 0.35 {
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
    (176.0..=212.0).contains(&hue)
}

/// Maske der türkisen Pixel eines BGRA-Ausschnitts.
pub fn marker_mask(bgra: &[u8]) -> Vec<bool> {
    bgra.chunks_exact(4).map(|p| is_marker_color(p[2], p[1], p[0])).collect()
}

/// Wie sehr der Ausschnitt dem Marker gleicht (0..1). Der Ausschnitt liegt mittig auf dem Fadenkreuz.
///
/// Der NERO-V-Marker sind vier kurze, dicke „Blätter“ auf den Diagonalen, etwa
/// 3–14 px von der Mitte (bei 1080p; gemessen an einem echten Kill). Gezählt werden
/// türkise Pixel je Diagonale: Alle vier müssen etwas zeigen (in Aufnahmen
/// verschwimmen die unteren gern), und außerhalb der Diagonalen darf kaum Türkis
/// sein – sonst ist es Himmel oder Wasser, kein Marker.
pub fn marker_score(mask: &[bool], width: usize, height: usize) -> f32 {
    if width == 0 || height == 0 || width.checked_mul(height) != Some(mask.len()) {
        return 0.0;
    }
    let scale = height as f32 / 64.0;
    let (cx, cy) = (width as f32 / 2.0, height as f32 / 2.0);
    let (r_in, r_out, band) = (2.5 * scale, 17.0 * scale, 4.0 * scale);
    let mut arm_hits = [0usize; 4];
    let mut outside = 0usize;
    let mut outside_area = 0usize;
    let mut border = 0usize;
    let mut center_hits = 0usize;
    let mut center_area = 0usize;
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            let r = (dx * dx + dy * dy).sqrt();
            let hit = mask[y * width + x];
            if r > r_out {
                border += usize::from(hit);
                continue;
            }
            if r < r_in {
                center_hits += usize::from(hit);
                center_area += 1;
                continue;
            }
            if (dx.abs() - dy.abs()).abs() <= band {
                arm_hits[usize::from(dx > 0.0) + 2 * usize::from(dy > 0.0)] += usize::from(hit);
            } else {
                outside_area += 1;
                outside += usize::from(hit);
            }
        }
    }
    let mut hits = arm_hits;
    hits.sort_unstable_by(|a, b| b.cmp(a));
    let area = scale * scale;
    // Ein einzelner Fleck, ein angeschnittenes Objekt oder ein großes türkises
    // Kreuz ist kein kleiner, freistehender Kill-Marker.
    if (hits[3] as f32) < area || border > arm_hits.iter().sum::<usize>() * 2 {
        return 0.0;
    }
    // Zweit- und drittstärkstes Blatt zusammen gegen ein deutlich sichtbares Blatt (~40 px).
    let strength = ((hits[1] + hits[2]) as f32 / (40.0 * area)).min(1.0);
    let third = (hits[2] as f32 / (4.0 * area)).min(1.0);
    // Wie viel der Fläche neben den Diagonalen ebenfalls türkis ist (Himmel, Wasser …).
    let spill = outside as f32 / outside_area.max(1) as f32;
    let center_fill = center_hits as f32 / center_area.max(1) as f32;
    strength * third * (1.0 - spill).powi(4) * (1.0 - center_fill).powi(2)
}

/// Bestätigt einen kurzen Marker-Puls erst nach dessen Verschwinden. Dauerhafte
/// Objekte, einzelne Frames und schon beim Start sichtbare Muster zählen nicht.
pub struct HitmarkerTracker {
    quiet_since: Option<f64>,
    pulse: Option<(f64, usize)>,
    last_sample: Option<f64>,
    last_event: f64,
    pub threshold: f32,
}

impl HitmarkerTracker {
    pub fn new(threshold: f32) -> Self {
        Self { quiet_since: None, pulse: None, last_sample: None, last_event: f64::MIN, threshold }
    }

    /// Liefert den Beginn des bestätigten Pulses für den Schnittzeitpunkt.
    pub fn update(&mut self, score: f32, now: f64) -> Option<f64> {
        if self.last_sample.is_some_and(|last| now - last > 0.35 || now < last) || !score.is_finite() {
            self.quiet_since = None;
            self.pulse = None;
        }
        self.last_sample = Some(now);
        if !score.is_finite() {
            return None;
        }
        if score < self.threshold * 0.6 {
            self.quiet_since.get_or_insert(now);
            if let Some((start, samples)) = self.pulse.take() {
                if samples >= 2 && (0.08..=0.7).contains(&(now - start)) && start - self.last_event >= 0.8 {
                    self.last_event = start;
                    return Some(start);
                }
            }
        } else if let Some((_, samples)) = self.pulse.as_mut() {
            if score >= self.threshold {
                *samples += 1;
            }
        } else if score >= self.threshold {
            if self.quiet_since.is_some_and(|since| now - since >= 0.25) {
                self.pulse = Some((now, 1));
            }
            self.quiet_since = None;
        } else {
            self.quiet_since = None;
        }
        None
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
                .map(|(i, t)| Word { text: t.to_string(), x0: i as f32 * 50.0, x1: i as f32 * 50.0 + 40.0, y0: 0.0, y1: 20.0 })
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
        assert_eq!(classify(&line("Du hast NV I Aki I FIB 1865] getotet")), Some(FeedEvent::Kill("NV | Aki | FIB [865]".into())));
        assert_eq!(classify(&line("Du wurdst von Max_Muster getötet")), Some(FeedEvent::Death("Max_Muster".into())));
        // Zu stark verstümmelte Lesungen brauchen eine spätere, klare Bestätigung.
        assert_eq!(classify(&line("I e sysTEMA.e,CE5 · rost W I Krypto I FIB (4391 get&et")), None);
        assert_eq!(classify(&line("wurdest von Max_Muster get&et")), None);
        assert_eq!(classify(&line("x getötet")), None);
        // Ein Tod wird nie als Kill gewertet, auch wenn „hast“ fehlt.
        assert!(!matches!(classify(&line("Du wurdest von Du hast getötet")), Some(FeedEvent::Kill(_))));
    }

    /// Echte Live-Lesungen aus FiveM (pixelscharf über WGC): „Du“ als „DJ“, und die Box
    /// bricht lange Meldungen um, sodass „getötet“ in der nächsten Zeile steht.
    #[test]
    fn real_live_reads_with_dj_and_wrapped_lines() {
        assert_eq!(classify(&line("DJ hast FB x Rehhard Kdto (1631 getötet")), Some(FeedEvent::Kill("FB x Rehhard Kdto (1631".into())));
        assert_eq!(
            events(&[line("SYSTEMSF,eoe"), line("DJ wudest von FIB x Rehhard Kaito (163"), line("getötet")]),
            vec![FeedEvent::Death("FIB x Rehhard Kaito (163".into())]
        );
        assert_eq!(
            events(&[line("e SYSTEMA.eE5"), line("DJ hast FIB x Reinhard Kaito [163]"), line("getötet")]),
            vec![FeedEvent::Kill("FIB x Reinhard Kaito [163]".into())]
        );
        // Ohne „getötet“ (abgeschnitten) bleibt es bei keinem Kill.
        assert_eq!(events(&[line("e SYSTEMA.eE5"), line("DJ hast FB x Rehhard Kdto (1631")]), vec![]);
        // Eine vollständige Zeile wird nicht noch einmal mit der nächsten verbunden.
        assert_eq!(
            events(&[line("Du hast Max getötet"), line("Du hast Moritz getötet")]),
            vec![FeedEvent::Kill("Max".into()), FeedEvent::Kill("Moritz".into())]
        );
    }

    /// Echte Lesefolgen aus FiveM (`live_detection_log`): je ein Kill, die OCR liest den
    /// Namen bei jeder Lesung etwas anders. Früher wurde daraus ein zweiter Kill.
    #[test]
    fn drifting_ocr_names_count_as_one_kill() {
        let replay = |reads: &[(f64, &str)]| {
            let mut tracker = KillfeedTracker::default();
            reads.iter().map(|(now, text)| tracker.update(&[line(text)], *now).len()).sum::<usize>()
        };
        assert_eq!(replay(&[
            (145.16, "DJ hast FB x Remard Kaito (1631 getötet"),
            (145.66, "DJ hast FB x Remard Kdto (1631 getötet"),
            (146.67, "DJ hast FB x Remard Kaito (1631 getötet"),
            (147.67, "DJ hast FB x Remard Kaito (1631 getötet"),
            (148.67, "DJ hast FB x Rehhard Kdto (1631 getötet"),
            (149.17, "DJ hast FB x Rehhard Kdto (1631 getötet"),
        ]), 1);
        assert_eq!(replay(&[
            (16.51, "DJ hast basti Salvatore I FIB [7301 getötet"),
            (17.01, "DJ hast Salvatore I FIB [7301 getötet"),
            (17.51, "DJ hast Salvatore I FIB [7301 getötet"),
            (18.01, "DJ hast Salvatore I FIB [7301 getötet"),
            (18.52, "DJ hast basti Salvatore I FIB [7301 getötet"),
            (19.02, "DJ hast basti Salvatore I FIB [7301 getötet"),
            (20.02, "DJ hast Salvatore I FIB [7301 getötet"),
        ]), 1);
        // Gestapelt: Derselbe Gegner zweimal kurz hintereinander steht zweimal untereinander.
        let mut tracker = KillfeedTracker::default();
        let one = line("Du hast FIB x Reinhard Kaito [163] getötet");
        let two = line("DJ hast FB x Remard Kdto (1631 getötet");
        assert_eq!(tracker.update(&[one.clone()], 0.0).len(), 0);
        assert_eq!(tracker.update(&[one.clone()], 0.5).len(), 1);
        assert_eq!(tracker.update(&[one.clone(), two.clone()], 1.0).len(), 0);
        assert_eq!(tracker.update(&[one.clone(), two.clone()], 1.5).len(), 1);
        // Die obere läuft ab, die untere rückt nach – kein weiterer Kill.
        assert_eq!(tracker.update(&[two.clone()], 2.0).len(), 0);
        assert_eq!(tracker.update(&[two], 2.5).len(), 0);
        // Zwei verschiedene Gegner bleiben zwei Kills.
        assert_eq!(replay(&[
            (1.0, "Du hast Max Mustermann [12] getötet"),
            (1.5, "Du hast Max Mustermann [12] getötet"),
            (2.0, "Du hast Erika Musterfrau [34] getötet"),
            (2.5, "Du hast Erika Musterfrau [34] getötet"),
        ]), 2);
    }

    #[test]
    fn ordinary_notifications_and_incomplete_or_negated_messages_are_not_kills() {
        for text in [
            "Du hast Max gerettet", "Du hast das Fahrzeug getestet",
            "Du hast den Motor gestartet", "Du hast 5000$ erhalten",
            "SYSTEM SUCCESS Fahrzeug getötet", "Max wurde getötet",
            "hast Max getötet", "Du hat Max getötet", "Du hast getötet",
            "Du hast Max nicht getötet", "Du hast niemanden getötet",
            "Du hast Max getötet oder gerettet", "Du hast Max get&et", "Du hast | getötet",
        ] {
            assert_eq!(classify(&line(text)), None, "{text}");
        }
        assert!(!mentions_killed(&line("Du hast Max gerettet")));
        assert!(!mentions_killed(&line("Du hast das Fahrzeug getestet")));
    }

    #[test]
    fn same_notification_counts_once_until_it_disappears() {
        let mut t = KillfeedTracker::default();
        let kill = line("Du hast NV | Aki | FIB [865] getötet");
        assert_eq!(t.update(&[kill.clone()], 0.0).len(), 0);
        assert_eq!(t.update(&[kill.clone()], 0.5).len(), 1);
        // OCR liest dieselbe Meldung leicht anders → kein neuer Kill.
        assert_eq!(t.update(&[line("Du hast NV I Aki | FIB [865] getotet")], 1.0).len(), 0);
        // Tod desselben Spielers ist ein eigenes Ereignis.
        let death = line("Du wurdest von NV | Aki | FIB [865] getötet");
        assert!(t.update(&[death.clone()], 1.2).is_empty());
        assert_eq!(t.update(&[death], 1.5), vec![FeedEvent::Death("NV | Aki | FIB [865]".into())]);
        // Weg und wieder da → neuer Kill.
        assert_eq!(t.update(&[], 6.0).len(), 0);
        assert_eq!(t.update(&[kill.clone()], 6.5).len(), 0);
        assert_eq!(t.update(&[kill], 6.8).len(), 1);
    }

    #[test]
    fn single_ocr_hallucination_or_duplicate_rows_do_not_trigger() {
        let mut t = KillfeedTracker::default();
        let kill = line("Du hast Max getötet");
        assert!(t.update(&[kill.clone(), kill.clone()], 0.0).is_empty());
        assert!(t.update(&[], 0.3).is_empty());
        assert!(t.update(&[kill.clone()], 1.0).is_empty());
        assert_eq!(t.update(&[kill.clone(), kill], 1.3), vec![FeedEvent::Kill("Max".into())]);
    }

    #[test]
    fn standing_notification_and_short_ocr_dropout_do_not_retrigger() {
        let mut t = KillfeedTracker::default();
        let kill = line("Du hast Max getötet");
        assert!(t.update(&[kill.clone()], 0.0).is_empty());
        assert_eq!(t.update(&[kill.clone()], 0.75).len(), 1);
        for i in 2..20 {
            let lines = if i == 10 { vec![] } else { vec![kill.clone()] };
            assert!(t.update(&lines, i as f64 * 0.75).is_empty());
        }
    }

    #[test]
    fn separate_kills_in_the_same_feed_are_confirmed_independently() {
        let mut t = KillfeedTracker::default();
        let kills = [line("Du hast Alice getötet"), line("Du hast Bob getötet")];
        assert!(t.update(&kills, 0.0).is_empty());
        assert_eq!(t.update(&kills, 0.3), vec![FeedEvent::Kill("Alice".into()), FeedEvent::Kill("Bob".into())]);
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
        for d in 3..11 {
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
        let marker = marker_score(&marker_mask(&with_x(size)), size, size);
        let empty = marker_score(&marker_mask(&background(size)), size, size);
        let sky: Vec<u8> = (0..size * size).flat_map(|_| [116u8, 104, 40, 255]).collect();
        let sky = marker_score(&marker_mask(&sky), size, size);
        println!("Marker {marker}, Hintergrund {empty}, Fläche {sky}");
        assert!(marker > 0.25, "Marker {marker}");
        assert!(empty < 0.01, "Hintergrund {empty}");
        assert!(sky < 0.05, "türkise Fläche {sky}");
    }

    /// Echter NERO-V-Marker aus einem Replay (1080p, Bereich 64×64 um das Fadenkreuz):
    /// die oberen Blätter deutlich, die unteren verwaschen.
    const REAL_MARKER: [&str; 26] = [
        "........++++...+++++..................................",
        "........++++..++++++..................................",
        "........++++..++##++..................................",
        "........+++..+####++......##+.........................",
        "........+++.++#####+.....#####........................",
        "..........++++######....#######.......................",
        "...........+++######+...########......................",
        ".............+######++.##########.....................",
        "..............+######+..######+##.....................",
        "................####+...####++........................",
        "......................................................",
        "......................................................",
        "......................................................",
        "......................................................",
        ".................+........+##.........................",
        "................#+.......++###........................",
        "...............#++........++##........................",
        "..............+#++........++#+........................",
        "...............+++.........+++........................",
        "......................................................",
        "......................................................",
        "......................................................",
        "......................................................",
        "......................................................",
        "......................................................",
        "......................................................",
    ];

    #[test]
    fn real_marker_from_a_replay_is_found() {
        // Zeilen 20–45 des Bereichs, Spalten ab 10 (links nur Hintergrund).
        let mut mask = vec![false; 64 * 64];
        for (row, line) in REAL_MARKER.iter().enumerate() {
            for (col, c) in line.chars().enumerate() {
                mask[(20 + row) * 64 + 10 + col] = c == '#';
            }
        }
        let score = marker_score(&mask, 64, 64);
        assert!(score >= 0.25, "echter Marker {score}");
    }

    #[test]
    fn marker_fires_once_per_appearance() {
        let mut h = HitmarkerTracker::new(0.25);
        assert_eq!(h.update(0.0, 0.0), None);
        assert_eq!(h.update(0.0, 0.2), None);
        assert_eq!(h.update(0.5, 0.3), None);
        assert_eq!(h.update(0.45, 0.4), None);
        assert_eq!(h.update(0.2, 0.5), None); // Hysterese: noch aktiv
        assert_eq!(h.update(0.0, 0.6), Some(0.3));
        for i in 7..12 {
            assert_eq!(h.update(0.0, i as f64 / 10.0), None);
        }
        assert_eq!(h.update(0.5, 1.2), None);
        assert_eq!(h.update(0.5, 1.3), None);
        assert_eq!(h.update(0.0, 1.4), Some(1.2));
    }

    #[test]
    fn startup_flash_single_frame_and_sustained_objects_do_not_trigger() {
        for (quiet, high) in [(0, 2), (3, 1), (3, 12)] {
            let mut h = HitmarkerTracker::new(0.25);
            for i in 0..quiet + high + 5 {
                let score = if i >= quiet && i < quiet + high { 0.8 } else { 0.0 };
                assert_eq!(h.update(score, i as f64 * 0.1), None, "quiet={quiet}, high={high}, frame={i}");
            }
        }
    }

    #[test]
    fn capture_gaps_do_not_complete_a_marker_pulse() {
        let mut h = HitmarkerTracker::new(0.25);
        for (score, time) in [(0.0, 0.0), (0.0, 0.2), (0.8, 0.3), (0.8, 0.4), (0.0, 1.0)] {
            assert_eq!(h.update(score, time), None);
        }
    }

    #[test]
    fn turquoise_blobs_partial_markers_and_large_crosses_are_rejected() {
        let size = 64;
        for shape in 0..4 {
            let mut mask = vec![false; size * size];
            for y in 0..size {
                for x in 0..size {
                    let dx = x as f32 + 0.5 - 32.0;
                    let dy = y as f32 + 0.5 - 32.0;
                    mask[y * size + x] = match shape {
                        0 => dx * dx + dy * dy < 12.0 * 12.0,
                        1 => dx.abs() < 10.0 && dy.abs() < 10.0,
                        2 => (dx.abs() - dy.abs()).abs() < 2.0 && dy < 0.0,
                        _ => (dx.abs() - dy.abs()).abs() < 3.0,
                    };
                }
            }
            assert!(marker_score(&mask, size, size) < 0.25, "shape={shape}");
        }
        assert_eq!(marker_score(&[], 0, 0), 0.0);
        assert_eq!(marker_score(&[true], 64, 64), 0.0);
    }
}
