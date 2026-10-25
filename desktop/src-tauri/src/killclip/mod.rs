//! Kill-Clips: Kills im Spiel erkennen, Clip im Clip-Programm speichern lassen,
//! die Kills (± ein paar Sekunden) herausschneiden, unter das Discord-Limit
//! rendern und als Bot in den eigenen Clips-Channel posten.
//!
//! Zwei Threads: Der Wächter schaut ~10× pro Sekunde auf kleine
//! Bildschirmausschnitte und sammelt Kills zu Serien. Der Arbeiter speichert,
//! schneidet und lädt jede fertige Serie hoch – die Erkennung läuft derweil weiter.

pub mod detect;
pub mod ocr;
pub mod plan;
pub mod render;
pub mod reference;
pub mod screen;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::{api, clipper, media, AppState};
use detect::{FeedEvent, HitmarkerTracker, KillfeedTracker};
use screen::{Image, Region};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// Früher für die Namenssuche nötig – der NERO-V-Kill-Feed sagt „Du hast …“ selbst.
    pub player_name: String,
    pub killfeed: Option<Region>,
    /// Bereich des Kill-Markers; ohne Angabe die Bildschirmmitte (Fadenkreuz).
    pub hitmarker: Option<Region>,
    pub hitmarker_threshold: f32,
    /// Ohne eingerichteten Kill-Feed kurze Kill-Marker-Pulse auswerten.
    pub use_marker: bool,
    /// Kills mit höchstens so viel Abstand landen im selben Video.
    pub merge_seconds: u32,
    pub pre_seconds: f32,
    pub post_seconds: f32,
    /// Länge des Replay-Puffers, wenn das Programm sie nicht verrät (Medal).
    pub replay_seconds: u32,
    /// Nach dem Schneiden die lange Originalaufnahme löschen.
    pub delete_source: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            player_name: String::new(),
            killfeed: None,
            hitmarker: None,
            hitmarker_threshold: 0.25,
            use_marker: true,
            merge_seconds: 60,
            pre_seconds: 3.0,
            post_seconds: 3.0,
            replay_seconds: 60,
            delete_source: true,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub channel: Option<ChannelInfo>,
    pub limit_bytes: u64,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ChannelInfo {
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    /// "idle" | "watching" | "saving" | "rendering" | "uploading"
    pub phase: String,
    pub pending_kills: usize,
    pub target: Option<Target>,
    /// Was die Texterkennung zuletzt im Kill-Feed gelesen hat (zum Einstellen).
    pub last_feed: String,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    kind: &'static str,
    message: String,
    link: Option<String>,
    path: Option<String>,
    /// ms seit 1970
    at: u64,
}

/// Ein erkannter Kill; der Name kommt aus dem Kill-Feed (beim Marker allein unbekannt).
#[derive(Clone, Debug)]
struct Kill {
    at: SystemTime,
    victim: Option<String>,
}

struct Session {
    kills: Vec<Kill>,
}

#[derive(Default)]
pub struct KillClips {
    running: Arc<AtomicBool>,
    status: Arc<Mutex<Status>>,
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn emit_event(app: &AppHandle, kind: &'static str, message: impl Into<String>, link: Option<String>, path: Option<String>) {
    let _ = app.emit("killclip-event", Event { kind, message: message.into(), link, path, at: millis(SystemTime::now()) });
}

fn update_status(app: &AppHandle, status: &Arc<Mutex<Status>>, change: impl FnOnce(&mut Status)) {
    let snapshot = {
        let mut guard = status.lock().unwrap();
        change(&mut guard);
        guard.clone()
    };
    let _ = app.emit("killclip-status", snapshot);
}

pub fn screenshot_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|dir| dir.join("kill-clip-einrichtung.bmp"))
}

/// Bild mit dem deutlichsten Kill-Marker aus der Einrichtung (kann ein anderes sein als das mit der Meldung).
fn marker_frame_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|dir| dir.join("kill-clip-marker.bmp"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedReference {
    pub path: String,
    pub marker_path: Option<String>,
    pub width: u32,
    pub height: u32,
    pub hitmarker: Region,
}

/// Bilder der letzten Einrichtung – damit der Dialog beim nächsten Öffnen zeigt, was gilt.
pub fn saved_reference(app: &AppHandle) -> Option<SavedReference> {
    let path = screenshot_path(app)?;
    let shot = Image::load_bmp(&path)?;
    let marker = marker_frame_path(app).filter(|p| p.exists());
    Some(SavedReference {
        path: path.display().to_string(),
        marker_path: marker.map(|p| p.display().to_string()),
        width: shot.width,
        height: shot.height,
        hitmarker: center_region(shot.width, shot.height),
    })
}

/// Bild für den Marker-Probelauf: das Marker-Bild der Einrichtung, sonst das Einrichtungsbild.
fn marker_frame(app: &AppHandle) -> Option<Image> {
    marker_frame_path(app).and_then(|p| Image::load_bmp(&p)).or_else(|| screenshot_path(app).and_then(|p| Image::load_bmp(&p)))
}

pub fn output_dir(app: &AppHandle) -> PathBuf {
    crate::videos_dir(app).join("FIB Kill-Clips")
}

impl KillClips {
    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    pub fn stop(&self, app: &AppHandle) {
        self.running.store(false, Ordering::SeqCst);
        update_status(app, &self.status, |s| {
            s.running = false;
            if s.phase == "watching" {
                s.phase = "idle".into();
            }
        });
    }

    pub async fn start(&self, app: AppHandle) -> Result<Status, String> {
        if self.running.load(Ordering::SeqCst) {
            return Ok(self.status());
        }
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap().clone();
        let config = settings.kill_clip.clone();
        let has_feed = config.killfeed.is_some();
        if !has_feed && !config.use_marker {
            return Err("Bitte zuerst den Kill-Feed-Bereich festlegen (oder den Kill-Marker einschalten).".into());
        }
        if settings.clipper == crate::settings::Clipper::SelfClip && !state.recorder.is_running() {
            return Err("FIB Self-Clip nimmt gerade nicht auf – bitte in den Einstellungen prüfen.".into());
        }

        let target: Target = serde_json::from_value(api::call(&state.client, "GET", "/api/desktop/kill-clips", None).await?)
            .map_err(|_| "Unerwartete Antwort vom Dashboard".to_string())?;

        // Bildschirm und Texterkennung vorab prüfen, damit Fehler sofort sichtbar sind.
        screen::with_screen(|_| Ok(()))?;
        if has_feed {
            ocr::Ocr::new()?;
        }

        self.running.store(true, Ordering::SeqCst);
        update_status(&app, &self.status, |s| {
            *s = Status { running: true, phase: "watching".into(), target: Some(target.clone()), ..Default::default() };
        });

        let (tx, rx) = mpsc::channel::<Session>();
        let running = self.running.clone();
        let status = self.status.clone();
        let watcher_app = app.clone();
        thread::Builder::new()
            .name("kill-clip-waechter".into())
            .spawn(move || watch(watcher_app, config, running, status, tx))
            .map_err(|e| e.to_string())?;

        let status = self.status.clone();
        let worker_app = app.clone();
        thread::Builder::new()
            .name("kill-clip-arbeiter".into())
            .spawn(move || work(worker_app, target, status, rx))
            .map_err(|e| e.to_string())?;
        Ok(self.status())
    }
}

/// Mittlere Helligkeitsänderung – bei 0 hat sich der Kill-Feed nicht bewegt.
fn changed(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return true;
    }
    let sum: u64 = a.iter().zip(b).map(|(x, y)| x.abs_diff(*y) as u64).sum();
    sum as f64 / a.len().max(1) as f64 > 1.0
}

const TICK: Duration = Duration::from_millis(100);
/// Texterkennung höchstens so oft – reicht für Kill-Feeds, die Sekunden stehen bleiben.
const OCR_EVERY: f64 = 0.25;

/// Meldet einen Bildschirmfehler erst, wenn er länger als 5 Sekunden anhält.
fn report_screen_error(app: &AppHandle, status: &Arc<Mutex<Status>>, failing_since: &mut Option<Instant>, error: String) {
    let since = *failing_since.get_or_insert_with(Instant::now);
    if since.elapsed() >= Duration::from_secs(5) {
        update_status(app, status, |s| s.error = Some(format!("{error} – die App versucht es weiter.")));
    }
}

/// Ab diesem Wert gilt der Kill-Marker als gesehen (Live-Erkennung, Einrichtung und Probelauf).
pub const MARKER_THRESHOLD: f32 = 0.25;

/// Bereich um das Fadenkreuz in der Bildschirmmitte, passend zur Auflösung.
fn center_region(width: u32, height: u32) -> Region {
    let size = ((64.0 * height as f32 / 1080.0).round() as u32).max(48);
    Region { x: (width - size) / 2, y: (height - size) / 2, width: size, height: size }
}

fn watch(
    app: AppHandle,
    config: Config,
    running: Arc<AtomicBool>,
    status: Arc<Mutex<Status>>,
    jobs: mpsc::Sender<Session>,
) {
    let ocr = if config.killfeed.is_some() {
        match ocr::Ocr::new() {
            Ok(ocr) => Some(ocr),
            Err(error) => {
                running.store(false, Ordering::SeqCst);
                update_status(&app, &status, |s| {
                    s.running = false;
                    s.phase = "idle".into();
                    s.error = Some(error);
                });
                return;
            }
        }
    } else {
        None
    };

    let replay = {
        let settings = app.state::<AppState>().settings.lock().unwrap().clone();
        match settings.clipper {
            crate::settings::Clipper::SelfClip => settings.self_clip.buffer_seconds,
            other => clipper::replay_seconds(other).unwrap_or(config.replay_seconds),
        }
    } as f64;
    let (pre, post, merge) = (config.pre_seconds as f64, config.post_seconds as f64, config.merge_seconds as f64);

    let started = Instant::now();
    // Größe des Monitors, für den `regions` gilt – nach einem Wechsel neu festlegen.
    let mut size: Option<(u32, u32)> = None;
    let mut regions: Vec<Region> = Vec::new();
    let mut feed_index = None;
    let mut marker_index = None;
    let mut feed = KillfeedTracker::default();
    // Feste Schwelle: Ältere Einstellungen enthalten noch Werte früherer Erkennungen.
    let mut marker = HitmarkerTracker::new(MARKER_THRESHOLD);
    let mut last_feed: Vec<u8> = Vec::new();
    let mut last_ocr = f64::MIN;
    let mut session: Vec<Kill> = Vec::new();
    // Seit wann der Bildschirm nicht lesbar ist – kurze Aussetzer (Vollbild-Umschaltung) nicht melden.
    let mut failing_since: Option<Instant> = None;

    let flush = |session: &mut Vec<Kill>| {
        if !session.is_empty() {
            let _ = jobs.send(Session { kills: std::mem::take(session) });
        }
    };

    while running.load(Ordering::SeqCst) {
        let tick = Instant::now();
        let now = started.elapsed().as_secs_f64();

        let grabbed = screen::with_screen(|opened| {
            if size != Some((opened.width, opened.height)) {
                // Bereiche passend zum (evtl. neuen) Monitor festlegen.
                size = Some((opened.width, opened.height));
                regions.clear();
                feed_index = config.killfeed.filter(|_| ocr.is_some()).map(|r| {
                    regions.push(r);
                    regions.len() - 1
                });
                // Mit Kill-Feed entscheidet ausschließlich die bestätigte Meldung.
                // Ein türkises Objekt darf die Texterkennung niemals umgehen.
                marker_index = (config.use_marker && config.killfeed.is_none()).then(|| {
                    // Der Marker sitzt immer genau auf dem Fadenkreuz – ein von Hand verrutschter Rahmen zählt nicht.
                    regions.push(center_region(opened.width, opened.height));
                    regions.len() - 1
                });
            }
            opened.grab(&regions, 50)
        });
        let mut new_kills: Vec<Kill> = Vec::new();
        let ok = grabbed.is_ok();
        match grabbed {
            Ok(Some(images)) => {
                if let Some(i) = marker_index {
                    let image = &images[i];
                    let mask = detect::marker_mask(&image.bgra);
                    let score = detect::marker_score(&mask, image.width as usize, image.height as usize);
                    if let Some(at) = marker.update(score, now) {
                        new_kills.push(Kill { at: SystemTime::now() - Duration::from_secs_f64(now - at), victim: None });
                        emit_event(&app, "kill", "Kill erkannt (Kill-Marker)", None, None);
                    }
                }
                if let (Some(i), Some(ocr)) = (feed_index, &ocr) {
                    let gray = images[i].gray();
                    // Auch stehende Meldungen erneut lesen: zur Bestätigung und
                    // damit sie bei einer späteren Animation nicht nochmals zählen.
                    if now - last_ocr >= OCR_EVERY && (feed.needs_confirmation() || changed(&gray, &last_feed) || now - last_ocr >= 0.75) {
                        last_ocr = now;
                        if let Ok(lines) = ocr.read_feed(&images[i]) {
                            last_feed = gray;
                            for event in feed.update(&lines, now) {
                                match event {
                                    FeedEvent::Kill(victim) => {
                                        new_kills.push(Kill { at: SystemTime::now(), victim: Some(victim.clone()) });
                                        emit_event(&app, "kill", format!("Kill: {victim}"), None, None);
                                    }
                                    // Eigener Tod: nur anzeigen, kein Clip.
                                    FeedEvent::Death(killer) => emit_event(&app, "death", format!("Getötet von {killer}"), None, None),
                                }
                            }
                            let text = lines.iter().map(|l| l.text()).collect::<Vec<_>>().join(" | ");
                            status.lock().unwrap().last_feed = text;
                        }
                    }
                }
            }
            Ok(None) => {}
            Err(error) => {
                report_screen_error(&app, &status, &mut failing_since, error);
                thread::sleep(Duration::from_secs(1));
                continue;
            }
        }
        // Läuft wieder: eine alte Fehlermeldung verschwinden lassen.
        if ok && failing_since.take().is_some() {
            update_status(&app, &status, |s| s.error = None);
        }

        if !new_kills.is_empty() {
            session.extend(new_kills);
            let pending = session.len();
            update_status(&app, &status, |s| {
                s.pending_kills = pending;
                s.error = None;
            });
        }

        // Serie abschließen: lange genug Ruhe – oder der Puffer des Clip-Programms läuft bald über.
        if let (Some(first), Some(last)) = (session.first(), session.last()) {
            let since_last = last.at.elapsed().map(|d| d.as_secs_f64()).unwrap_or(0.0);
            let since_first = first.at.elapsed().map(|d| d.as_secs_f64()).unwrap_or(0.0);
            let buffer_full = since_first + pre + 10.0 >= replay;
            if since_last >= post + 0.5 && (since_last >= merge || buffer_full) {
                flush(&mut session);
                update_status(&app, &status, |s| s.pending_kills = 0);
            }
        }

        if let Some(rest) = TICK.checked_sub(tick.elapsed()) {
            thread::sleep(rest);
        }
    }

    screen::release();

    // Beim Beenden angefangene Serien nicht verlieren.
    if let Some(last) = session.last() {
        let wait = (post + 0.5 - last.at.elapsed().map(|d| d.as_secs_f64()).unwrap_or(0.0)).max(0.0);
        thread::sleep(Duration::from_secs_f64(wait));
        flush(&mut session);
    }
}

fn work(app: AppHandle, target: Target, status: Arc<Mutex<Status>>, jobs: mpsc::Receiver<Session>) {
    for session in jobs {
        if let Err(error) = process(&app, &target, &status, &session) {
            emit_event(&app, "error", error.clone(), None, None);
            update_status(&app, &status, |s| s.error = Some(error));
        }
        update_status(&app, &status, |s| s.phase = if s.running { "watching".into() } else { "idle".into() });
    }
}

/// Lässt das Clip-Programm speichern und wartet auf die Datei.
fn save_replay(app: &AppHandle) -> Result<(PathBuf, SystemTime), String> {
    let state = app.state::<AppState>();
    // Bodycam und Kill-Clips teilen sich das Clip-Programm – nie gleichzeitig auslösen.
    while state.capturing.swap(true, Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(200));
    }
    let result = (|| {
        let settings = state.settings.lock().unwrap().clone();
        let saved_at = SystemTime::now();
        if settings.clipper == crate::settings::Clipper::SelfClip {
            return Ok((state.recorder.save(app, settings.self_clip.buffer_seconds, &crate::effective_clip_dir(app, &settings))?, saved_at));
        }
        let keys = clipper::parse_hotkey(&crate::effective_clipper_hotkey(&settings))?;
        clipper::press_hotkey(&keys);
        let path = clipper::wait_for_new_clip(&crate::effective_clip_dir(app, &settings), saved_at - Duration::from_secs(1), Duration::from_secs(90))?;
        Ok((path, saved_at))
    })();
    state.capturing.store(false, Ordering::SeqCst);
    result
}

/// Medal und AMD verraten die Länge ihres Puffers nicht – die erste Aufnahme zeigt sie.
/// Gilt ab dem nächsten Start der Erkennung.
fn remember_replay_length(app: &AppHandle, clip_len: f64) {
    let state = app.state::<AppState>();
    let mut settings = state.settings.lock().unwrap();
    let seconds = clip_len.floor() as u32;
    let learns = matches!(settings.clipper, crate::settings::Clipper::Medal | crate::settings::Clipper::Amd);
    if learns && seconds >= 15 && settings.kill_clip.replay_seconds.abs_diff(seconds) > 5 {
        settings.kill_clip.replay_seconds = seconds;
        let _ = crate::settings::save(app, &settings);
    }
}

fn process(app: &AppHandle, target: &Target, status: &Arc<Mutex<Status>>, session: &Session) -> Result<(), String> {
    let config = app.state::<AppState>().settings.lock().unwrap().kill_clip.clone();
    update_status(app, status, |s| s.phase = "saving".into());
    let (source, saved_at) = save_replay(app)?;
    let clip_len = media::duration_seconds(&source).ok_or("Länge der Aufnahme nicht lesbar")?;
    remember_replay_length(app, clip_len);

    // Kill-Zeitpunkte relativ zur Aufnahme: sie endet beim Speichern.
    let kills: Vec<f64> = session
        .kills
        .iter()
        .map(|kill| clip_len - saved_at.duration_since(kill.at).map(|d| d.as_secs_f64()).unwrap_or(0.0))
        .collect();
    let limit = if target.channel.is_some() && target.limit_bytes > 0 { target.limit_bytes } else { 50 * 1024 * 1024 };
    let outputs = plan::plan(&kills, clip_len, config.pre_seconds as f64, config.post_seconds as f64, limit);
    if outputs.is_empty() {
        return Err("Die Kills liegen außerhalb der gespeicherten Aufnahme – ist der Replay-Puffer zu kurz?".into());
    }

    update_status(app, status, |s| s.phase = "rendering".into());
    let first = session.kills.first().unwrap().at;
    let last = session.kills.last().unwrap().at;
    let stamp = chrono::DateTime::<chrono::Local>::from(first).format("%Y-%m-%d %H-%M-%S").to_string();
    let parts = outputs.len();
    let mut rendered = Vec::new();
    for (index, output) in outputs.iter().enumerate() {
        let name = if parts > 1 { format!("Kill-Clip {stamp} Teil {}.mp4", index + 1) } else { format!("Kill-Clip {stamp}.mp4") };
        let mut output = output.clone();
        // Der Encoder trifft die Bitrate nicht exakt – zu groß geratene Dateien mit weniger Bitrate wiederholen.
        let path = loop {
            let path = render::render(&source, clip_len, &output, &output_dir(app), &name)?;
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size <= limit * 97 / 100 {
                break path;
            }
            let _ = std::fs::remove_file(&path);
            output.video_bitrate = (output.video_bitrate as f64 * (limit as f64 * 0.9 / size as f64)) as u32;
            if output.video_bitrate < 600_000 {
                return Err("Das Video passt auch bei niedriger Qualität nicht unter das Discord-Limit.".into());
            }
        };
        emit_event(app, "rendered", format!("{} gespeichert ({} Kills)", name, output.kills), None, Some(path.display().to_string()));
        // Namen der Kills, die in diesem Video zu sehen sind.
        let victims: Vec<String> = session
            .kills
            .iter()
            .zip(&kills)
            .filter(|(_, at)| output.ranges.iter().any(|(a, b)| **at >= *a && **at <= *b))
            .filter_map(|(kill, _)| kill.victim.clone())
            .collect();
        rendered.push((path, output.kills, victims));
    }

    if config.delete_source {
        let _ = std::fs::remove_file(&source);
    }

    if target.channel.is_none() {
        return Err(target.reason.clone().unwrap_or_else(|| "Kein Clips-Channel – Videos nur lokal gespeichert.".into()));
    }
    update_status(app, status, |s| s.phase = "uploading".into());
    let client = app.state::<AppState>().client.clone();
    let started_at = chrono::DateTime::<chrono::Utc>::from(first).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let ended_at = chrono::DateTime::<chrono::Utc>::from(last).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    for (index, (path, kills, victims)) in rendered.iter().enumerate() {
        let link = tauri::async_runtime::block_on(async {
            let upload_id = api::upload_file(&client, path, Arc::default(), |_| {}).await?;
            let body = json!({
                "uploadId": upload_id,
                "startedAt": started_at,
                "endedAt": ended_at,
                "kills": kills,
                "victims": victims,
                "part": index + 1,
                "parts": parts,
            });
            let result = api::call(&client, "POST", "/api/desktop/kill-clips", Some(body)).await?;
            Ok::<_, String>(result.get("link").and_then(|l| l.as_str()).map(str::to_string))
        })?;
        emit_event(app, "uploaded", format!("Hochgeladen in #{}", target.channel.as_ref().map(|c| c.name.as_str()).unwrap_or("")), link, Some(path.display().to_string()));
    }
    Ok(())
}

/// Einrichtung: Das Clip-Programm speichert die letzten Sekunden (mit dem Kill darin).
pub fn record_reference(app: &AppHandle) -> Result<(PathBuf, f64), String> {
    let (path, _) = save_replay(app)?;
    let duration = media::duration_seconds(&path).ok_or("Länge der Aufnahme nicht lesbar")?;
    Ok((path, duration))
}

/// Einrichtung: Bilder um den markierten Kill auswerten und als Referenz ablegen.
pub fn analyze_reference(app: &AppHandle, clip: &std::path::Path, at: f64) -> Result<reference::Reference, String> {
    let frame = screenshot_path(app).ok_or("Cache-Ordner fehlt")?;
    let marker = marker_frame_path(app).ok_or("Cache-Ordner fehlt")?;
    let result = reference::analyze(clip, at, &frame, &marker);
    // Nur für die Monitorgröße geöffnet – läuft die Erkennung nicht, wieder freigeben.
    if !app.state::<AppState>().kill_clips.running.load(Ordering::SeqCst) {
        screen::release();
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedTest {
    pub lines: Vec<String>,
    /// Erkannte eigene Kills (Name des Opfers).
    pub kills: Vec<String>,
    /// Erkannte eigene Tode (Name des Gegners) – lösen keinen Clip aus.
    pub deaths: Vec<String>,
}

/// Probelauf der Texterkennung auf dem Screenshot – zeigt, was die App liest.
pub fn test_killfeed(app: &AppHandle, region: Region) -> Result<FeedTest, String> {
    let shot = screenshot_path(app).and_then(|p| Image::load_bmp(&p)).ok_or("Erst einen Kill aufnehmen")?;
    let crop = shot.crop(region).ok_or("Bereich liegt außerhalb des Screenshots")?;
    let lines = ocr::Ocr::new()?.read_feed(&crop)?;
    let events: Vec<FeedEvent> = lines.iter().filter_map(detect::classify).collect();
    Ok(FeedTest {
        lines: lines.iter().map(|l| l.text()).collect(),
        kills: events.iter().filter_map(|e| if let FeedEvent::Kill(n) = e { Some(n.clone()) } else { None }).collect(),
        deaths: events.iter().filter_map(|e| if let FeedEvent::Death(n) = e { Some(n.clone()) } else { None }).collect(),
    })
}

/// Probelauf des Kill-Markers auf dem Marker-Bild der Einrichtung (Bereich um das Fadenkreuz).
pub fn test_marker(app: &AppHandle) -> Result<f32, String> {
    let shot = marker_frame(app).ok_or("Erst einen Kill aufnehmen")?;
    let crop = shot.crop(center_region(shot.width, shot.height)).ok_or("Bild zu klein")?;
    Ok(detect::marker_score(&detect::marker_mask(&crop.bgra), crop.width as usize, crop.height as usize))
}

#[cfg(test)]
mod tests {
    use super::*;
    use screen::Screen;

    /// Liest ein Kill-Feed-Bild (Pfad in `FIB_KILLFEED_BMP`) mit der Windows-OCR.
    #[test]
    #[ignore]
    fn ocr_reads_nerov_notifications() {
        let path = std::env::var("FIB_KILLFEED_BMP").expect("FIB_KILLFEED_BMP setzen");
        let image = Image::load_bmp(std::path::Path::new(&path)).expect("BMP lesbar");
        let ocr = ocr::Ocr::new().unwrap();
        for scale in [1, 2, 3, 4] {
            for invert in [false, true] {
                let lines = ocr.read_with(&image, scale, invert).unwrap();
                let found: Vec<_> = lines.iter().filter_map(detect::classify).collect();
                println!("Variante {scale}x{}: {found:?}", if invert { " invertiert" } else { "" });
            }
        }
        let started = Instant::now();
        let lines = ocr.read(&image).unwrap();
        println!("OCR in {:?}:", started.elapsed());
        for line in &lines {
            println!("  {:?} → {:?}", line.text(), detect::classify(line));
        }
        let events: Vec<FeedEvent> = lines.iter().filter_map(detect::classify).collect();
        assert!(events.iter().any(|e| matches!(e, FeedEvent::Kill(_))), "Kill erkannt");
        assert!(events.iter().any(|e| matches!(e, FeedEvent::Death(_))), "Tod erkannt");
    }

    /// Wie in der App: Prozess ist Per-Monitor-DPI-bewusst (v2).
    #[test]
    #[ignore]
    fn grabs_with_dpi_awareness_like_the_app() {
        unsafe {
            let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        match Screen::open() {
            Ok(mut screen) => {
                let size = (screen.width, screen.height);
                println!("DPI v2: ok {size:?} – {:?}", screen.screenshot().map(|i| i.width));
            }
            Err(error) => println!("DPI v2: FEHLER {error}"),
        }
    }

    /// Läuft die Erkennung, darf der Einrichtungs-Screenshot nicht an „Falscher Parameter“ scheitern.
    #[test]
    #[ignore]
    fn screenshot_while_watching() {
        screen::with_screen(|_| Ok(())).unwrap();
        screen::release();
        let shot = screen::with_screen(|screen| screen.screenshot());
        assert!(shot.is_ok(), "{:?}", shot.err());
        screen::with_screen(|screen| screen.grab(&[Region { x: 0, y: 0, width: 32, height: 32 }], 50)).unwrap();
        screen::release();
    }

    /// Echter Bildschirm: Screenshot und kleiner Ausschnitt über DXGI.
    #[test]
    #[ignore]
    fn grabs_the_primary_monitor() {
        let mut screen = Screen::open().unwrap();
        let shot = screen.screenshot().unwrap();
        println!("Monitor {}×{}", shot.width, shot.height);
        assert_eq!((shot.width, shot.height), (screen.width, screen.height));
        assert!(shot.bgra.iter().any(|&b| b != 0), "Bild ist schwarz");
        let crop = shot.crop(Region { x: 10, y: 10, width: 64, height: 32 }).unwrap();
        assert_eq!(crop.bgra.len(), 64 * 32 * 4);
    }
}
