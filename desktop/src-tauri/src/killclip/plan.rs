//! Schnittplan: Aus den Kill-Zeitpunkten in einer Aufnahme werden Ausschnitte
//! (Kill ± Vor-/Nachlauf), dicht beieinanderliegende verschmelzen. Passt das
//! Ergebnis bei brauchbarer Qualität nicht unter das Discord-Limit, wird es auf
//! mehrere Videos verteilt.

/// Ausschnitte mit höchstens so viel Lücke werden zu einem durchgehenden Stück.
const JOIN_GAP: f64 = 1.0;
/// Darunter sieht 720p unbrauchbar aus – dann lieber auf mehrere Videos verteilen.
const MIN_VIDEO_BITRATE: f64 = 2_500_000.0;
const MAX_VIDEO_BITRATE: f64 = 12_000_000.0;
pub const AUDIO_BITRATE: f64 = 128_000.0;
/// Reserve für MP4-Container und Schwankungen des Encoders.
const SIZE_HEADROOM: f64 = 0.8;

#[derive(Clone, Debug, PartialEq)]
pub struct Output {
    /// Ausschnitte in Sekunden der Quelle, in Reihenfolge.
    pub ranges: Vec<(f64, f64)>,
    pub kills: usize,
    pub video_bitrate: u32,
    pub height: u32,
    pub fps: u32,
}

#[cfg(test)]
impl Output {
    pub fn duration(&self) -> f64 {
        self.ranges.iter().map(|(a, b)| b - a).sum()
    }
}

/// Ausschnitte um jeden Kill, überlappende und dicht folgende zusammengefasst.
pub fn ranges(kills: &[f64], clip_len: f64, pre: f64, post: f64) -> Vec<(f64, f64)> {
    let mut sorted: Vec<f64> = kills.iter().copied().filter(|k| k.is_finite()).collect();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let mut out: Vec<(f64, f64)> = Vec::new();
    for kill in sorted {
        let start = (kill - pre).max(0.0);
        let end = (kill + post).min(clip_len);
        if end - start < 0.5 {
            continue;
        }
        match out.last_mut() {
            Some(last) if start <= last.1 + JOIN_GAP => last.1 = last.1.max(end),
            _ => out.push((start, end)),
        }
    }
    out
}

/// Verteilt die Ausschnitte so auf Videos, dass jedes unter `limit_bytes` bleibt.
pub fn plan(kills: &[f64], clip_len: f64, pre: f64, post: f64, limit_bytes: u64) -> Vec<Output> {
    let budget_bits = limit_bytes as f64 * 8.0 * SIZE_HEADROOM;
    let max_duration = budget_bits / (MIN_VIDEO_BITRATE + AUDIO_BITRATE);

    // Zu lange Einzelstücke vorab teilen.
    let mut pieces: Vec<(f64, f64)> = Vec::new();
    for (start, end) in ranges(kills, clip_len, pre, post) {
        let mut cursor = start;
        while end - cursor > max_duration {
            pieces.push((cursor, cursor + max_duration));
            cursor += max_duration;
        }
        pieces.push((cursor, end));
    }

    let mut groups: Vec<Vec<(f64, f64)>> = Vec::new();
    let mut used = f64::MAX;
    for piece in pieces {
        let length = piece.1 - piece.0;
        if used + length > max_duration {
            groups.push(Vec::new());
            used = 0.0;
        }
        groups.last_mut().unwrap().push(piece);
        used += length;
    }

    groups
        .into_iter()
        .map(|ranges| {
            let duration: f64 = ranges.iter().map(|(a, b)| b - a).sum::<f64>().max(0.1);
            let bitrate = (budget_bits / duration - AUDIO_BITRATE).clamp(MIN_VIDEO_BITRATE, MAX_VIDEO_BITRATE);
            let (height, fps) = if bitrate >= 6_000_000.0 {
                (1080, 60)
            } else if bitrate >= 3_500_000.0 {
                (720, 60)
            } else {
                (720, 30)
            };
            let kills_inside = kills.iter().filter(|k| ranges.iter().any(|(a, b)| *k >= a && *k <= b)).count().max(1);
            Output { ranges, kills: kills_inside, video_bitrate: bitrate as u32, height, fps }
        })
        .collect()
}

/// Geschätzte Dateigröße eines Videos in Bytes.
#[cfg(test)]
pub fn estimated_bytes(output: &Output) -> f64 {
    output.duration() * (output.video_bitrate as f64 + AUDIO_BITRATE) / 8.0
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1024 * 1024;

    #[test]
    fn single_kill_is_six_seconds_in_one_hd_video() {
        let out = plan(&[100.0], 300.0, 3.0, 3.0, 50 * MB);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].ranges, vec![(97.0, 103.0)]);
        assert_eq!((out[0].height, out[0].fps, out[0].kills), (1080, 60, 1));
        assert!(estimated_bytes(&out[0]) < 50.0 * MB as f64);
    }

    #[test]
    fn close_kills_merge_into_one_piece() {
        let r = ranges(&[10.0, 14.0, 30.0], 60.0, 3.0, 3.0);
        assert_eq!(r, vec![(7.0, 17.0), (27.0, 33.0)]);
    }

    #[test]
    fn kills_at_clip_edges_are_clamped() {
        assert_eq!(ranges(&[1.0, 59.0], 60.0, 3.0, 3.0), vec![(0.0, 4.0), (56.0, 60.0)]);
    }

    #[test]
    fn spree_within_limit_stays_one_video() {
        // 8 Kills mit je ~40 s Abstand: 8 × 6 s = 48 s – passt in 50 MB.
        let kills: Vec<f64> = (0..8).map(|i| 20.0 + i as f64 * 40.0).collect();
        let out = plan(&kills, 400.0, 3.0, 3.0, 50 * MB);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].ranges.len(), 8);
        assert_eq!(out[0].kills, 8);
        assert!(estimated_bytes(&out[0]) <= 50.0 * MB as f64);
    }

    #[test]
    fn too_much_for_ten_megabytes_is_split() {
        // 10 MB tragen bei Mindestqualität ~26 s – 8 × 6 s müssen geteilt werden.
        let kills: Vec<f64> = (0..8).map(|i| 20.0 + i as f64 * 40.0).collect();
        let out = plan(&kills, 400.0, 3.0, 3.0, 10 * MB);
        assert!(out.len() >= 2, "{out:?}");
        assert_eq!(out.iter().map(|o| o.kills).sum::<usize>(), 8);
        for o in &out {
            assert!(estimated_bytes(o) <= 10.0 * MB as f64, "{o:?}");
        }
    }

    #[test]
    fn very_long_continuous_fight_is_cut_into_parts() {
        // Kills alle 2 s über 4 Minuten → ein durchgehendes Stück, länger als ein Video trägt.
        let kills: Vec<f64> = (0..120).map(|i| 10.0 + i as f64 * 2.0).collect();
        let out = plan(&kills, 300.0, 3.0, 3.0, 10 * MB);
        assert!(out.len() > 1);
        let total: f64 = out.iter().map(|o| o.duration()).sum();
        assert!((total - 244.0).abs() < 0.01, "{total}");
        for o in &out {
            assert!(estimated_bytes(o) <= 10.0 * MB as f64);
        }
    }
}
