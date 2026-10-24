//! Tweak-Engine: plant, sichert, wendet an, prüft, rollt zurück und stellt wieder her.
//! Arbeitet nur über die Traits aus `platform.rs` – in Tests mit Attrappen.

use serde::{Deserialize, Serialize};

use super::backup::{now_stamp, BackupFile, BackupStore, Entry, Failure, Target, Value};
use super::model::{meta, ErrorCode, Kind, Meta, TweakError, TweakId, TweakResult, TweakState};
use super::platform::{Hive, RegValue, Registry, SystemParams, FKF_FILTERKEYSON, FKF_HOTKEYACTIVE};

pub const MOUSE_KEY: &str = r"Control Panel\Mouse";
pub const KEYBOARD_KEY: &str = r"Control Panel\Keyboard";
pub const MMCSS_PROFILE: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile";
pub const MMCSS_GAMES: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games";
pub const KBDCLASS_PARAMS: &str = r"SYSTEM\CurrentControlSet\Services\kbdclass\Parameters";
pub const MOUCLASS_PARAMS: &str = r"SYSTEM\CurrentControlSet\Services\mouclass\Parameters";
pub const I8042_SERVICE: &str = r"SYSTEM\CurrentControlSet\Services\i8042prt";
pub const I8042_PARAMS: &str = r"SYSTEM\CurrentControlSet\Services\i8042prt\Parameters";

/// Windows-Standard der Klassentreiber, wenn der Wert nicht gesetzt ist.
const DEFAULT_QUEUE_SIZE: u32 = 100;

#[derive(Clone, Debug, PartialEq)]
pub struct Change {
    pub target: Target,
    pub current: Value,
    pub desired: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedChange {
    pub tweak: TweakId,
    pub tweak_name: &'static str,
    pub setting: String,
    pub current: String,
    pub target: String,
    /// Schon so eingestellt – es wird nichts geschrieben.
    pub unchanged: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingRow {
    pub label: String,
    pub current: String,
    pub target: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakReport {
    pub meta: Meta,
    pub state: TweakState,
    /// Nicht verfügbar (Grund) – z. B. fehlender Registry-Schlüssel.
    pub unsupported: Option<String>,
    /// Die App läuft ohne Administratorrechte; Anwenden fragt danach.
    pub needs_elevation: bool,
    pub settings: Vec<SettingRow>,
    pub explanation: Vec<String>,
    /// Werte wurden nach der App von jemand anderem geändert.
    pub external_change: bool,
    /// Windows stand schon vor der App auf dem Zielwert.
    pub already_at_target: bool,
    /// Die App hat hier Originalwerte gesichert.
    pub managed: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub written: usize,
    pub unchanged: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored: usize,
    /// Von anderen Programmen geänderte Werte – ohne `force` nicht angefasst.
    pub conflicts: Vec<String>,
    pub failures: Vec<String>,
}

pub struct Engine<'a> {
    pub reg: &'a dyn Registry,
    pub sys: &'a dyn SystemParams,
    pub admin: bool,
    pub store: BackupStore,
    pub app_version: String,
    /// Systemstart in ms seit 1970 – für „Neustart ausstehend“.
    pub boot_ms: u64,
}

fn reg_target(hive: Hive, path: &str, name: &str) -> Target {
    Target::Registry { hive, path: path.into(), name: name.into() }
}

impl<'a> Engine<'a> {
    // ── Lesen und Schreiben einzelner Ziele ──────────────────────────

    pub fn read(&self, target: &Target) -> TweakResult<Value> {
        Ok(match target {
            Target::Registry { hive, path, name } => self.reg.read(*hive, path, name)?.map(Value::Reg).unwrap_or(Value::Missing),
            Target::Mouse => Value::Mouse(self.sys.mouse()?),
            Target::KeyboardSpeed => Value::Number(self.sys.keyboard_speed()?),
            Target::KeyboardDelay => Value::Number(self.sys.keyboard_delay()?),
            Target::FilterKeys => Value::FilterKeys(self.sys.filter_keys()?),
        })
    }

    /// `persist = false`: SystemParametersInfo nur für die Sitzung, weil die
    /// gespeicherten Registry-Werte gerade byte-genau wiederhergestellt wurden.
    fn write(&self, target: &Target, value: &Value, persist: bool) -> TweakResult<()> {
        match (target, value) {
            (Target::Registry { hive, path, name }, Value::Reg(reg)) => self.reg.write(*hive, path, name, reg),
            (Target::Registry { hive, path, name }, Value::Missing) => self.reg.delete(*hive, path, name),
            (Target::Mouse, Value::Mouse(v)) => self.sys.set_mouse(*v, persist),
            (Target::KeyboardSpeed, Value::Number(v)) => {
                validate_range("Wiederholrate", *v, 0, 31)?;
                self.sys.set_keyboard_speed(*v, persist)
            }
            (Target::KeyboardDelay, Value::Number(v)) => {
                validate_range("Wiederholverzögerung", *v, 0, 3)?;
                self.sys.set_keyboard_delay(*v, persist)
            }
            (Target::FilterKeys, Value::FilterKeys(v)) => self.sys.set_filter_keys(*v),
            _ => Err(TweakError::invalid(format!("Wert passt nicht zu {}", target.label()))),
        }
    }

    /// Schreiben und gleich nachlesen – nur was wirklich angekommen ist, zählt.
    fn write_verified(&self, target: &Target, value: &Value, persist: bool) -> TweakResult<()> {
        self.write(target, value, persist)?;
        let now = self.read(target)?;
        if !now.same(value) {
            return Err(TweakError::new(
                ErrorCode::Verify,
                format!("{}: Windows meldet {} statt {}.", target.label(), now.display(), value.display()),
            ));
        }
        Ok(())
    }

    // ── Pläne ────────────────────────────────────────────────────────

    /// Was ein Tweak ändern würde, ausgehend vom aktuellen Zustand.
    pub fn plan(&self, id: TweakId) -> TweakResult<Vec<Change>> {
        let change = |target: Target, desired: Value| -> TweakResult<Change> {
            let current = self.read(&target)?;
            Ok(Change { target, current, desired })
        };
        match id {
            // Erst die gespeicherten Registry-Werte (mit Originaltyp gesichert), dann der Laufzeitwert.
            // [0, 0, 0]: Beschleunigung aus – entspricht „Zeigerpräzision verbessern“ aus.
            TweakId::MouseAcceleration => Ok(vec![
                change(reg_target(Hive::CurrentUser, MOUSE_KEY, "MouseSpeed"), Value::Reg(RegValue::sz("0")))?,
                change(reg_target(Hive::CurrentUser, MOUSE_KEY, "MouseThreshold1"), Value::Reg(RegValue::sz("0")))?,
                change(reg_target(Hive::CurrentUser, MOUSE_KEY, "MouseThreshold2"), Value::Reg(RegValue::sz("0")))?,
                change(Target::Mouse, Value::Mouse([0, 0, 0]))?,
            ]),
            TweakId::KeyboardRepeat => Ok(vec![
                change(reg_target(Hive::CurrentUser, KEYBOARD_KEY, "KeyboardSpeed"), Value::Reg(RegValue::sz("31")))?,
                change(reg_target(Hive::CurrentUser, KEYBOARD_KEY, "KeyboardDelay"), Value::Reg(RegValue::sz("0")))?,
                change(Target::KeyboardSpeed, Value::Number(31))?,
                change(Target::KeyboardDelay, Value::Number(0))?,
            ]),
            TweakId::KeyboardFilterkeys => {
                // Nur die Schalter ändern; Zeitwerte bleiben, damit ihre Kombination gültig bleibt.
                let current = self.sys.filter_keys()?;
                let desired = super::platform::FilterKeys { flags: current.flags & !(FKF_FILTERKEYSON | FKF_HOTKEYACTIVE), ..current };
                Ok(vec![Change { target: Target::FilterKeys, current: Value::FilterKeys(current), desired: Value::FilterKeys(desired) }])
            }
            TweakId::MmcssGames => {
                self.mmcss_supported()?;
                Ok(vec![change(reg_target(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category"), Value::Reg(RegValue::sz("High")))?])
            }
            _ => Err(TweakError::unsupported(format!("„{}“ ist eine reine Anzeige.", meta(id).name))),
        }
    }

    fn mmcss_supported(&self) -> TweakResult<()> {
        if !self.reg.key_exists(Hive::LocalMachine, MMCSS_GAMES)? {
            return Err(TweakError::unsupported("Der MMCSS-Task „Games“ existiert auf diesem System nicht."));
        }
        match self.reg.read(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category")? {
            Some(value) if value.as_text().is_none() => {
                Err(TweakError::unsupported("„Scheduling Category“ hat einen unerwarteten Datentyp – die App ändert ihn nicht."))
            }
            _ => Ok(()),
        }
    }

    pub fn preview(&self, ids: &[TweakId]) -> TweakResult<Vec<PlannedChange>> {
        let mut out = Vec::new();
        for &id in ids {
            for change in self.plan(id)? {
                out.push(PlannedChange {
                    tweak: id,
                    tweak_name: meta(id).name,
                    setting: change.target.label(),
                    current: change.current.display(),
                    target: change.desired.display(),
                    unchanged: change.current.same(&change.desired),
                });
            }
        }
        Ok(out)
    }

    // ── Anwenden ─────────────────────────────────────────────────────

    pub fn apply(&self, id: TweakId) -> TweakResult<ApplyResult> {
        let info = meta(id);
        if matches!(info.kind, Kind::Diagnostic | Kind::InGame) {
            return Err(TweakError::unsupported(format!("„{}“ lässt sich nicht umschalten.", info.name)));
        }
        if info.needs_admin && !self.admin {
            return Err(TweakError::needs_elevation());
        }
        let changes = self.plan(id)?;
        let mut backup = self.store.load()?;
        let (stamp, stamp_ms) = now_stamp();

        // 1. Originalwerte sichern, bevor irgendetwas geschrieben wird.
        let mut created: Vec<String> = Vec::new();
        for change in &changes {
            let key = change.target.key();
            match backup.entries.iter_mut().find(|e| e.key == key) {
                // Erneutes Aktivieren: Original bleibt unangetastet.
                Some(entry) => entry.applied = change.desired.clone(),
                None => {
                    backup.entries.push(Entry {
                        tweak: id,
                        key: key.clone(),
                        target: change.target.clone(),
                        original: change.current.clone(),
                        applied: change.desired.clone(),
                        created_at: stamp.clone(),
                        created_at_ms: stamp_ms,
                        app_version: self.app_version.clone(),
                    });
                    created.push(key);
                }
            }
        }
        self.store.save(&backup)?;

        // 2. Nacheinander schreiben und prüfen; beim ersten Fehler alles aus diesem Lauf zurück.
        let mut written: Vec<&Change> = Vec::new();
        let mut result = ApplyResult::default();
        for change in &changes {
            if change.current.same(&change.desired) {
                result.unchanged += 1;
                continue;
            }
            if let Err(error) = self.write_verified(&change.target, &change.desired, true) {
                let mut rollback_failed = Vec::new();
                for done in written.iter().rev() {
                    if let Err(e) = self.write_verified(&done.target, &done.current, true) {
                        rollback_failed.push(format!("{}: {}", done.target.label(), e.message));
                    }
                }
                // Der fehlgeschlagene Wert selbst: zurück auf den Stand vor diesem Lauf.
                let _ = self.write(&change.target, &change.current, true);
                if rollback_failed.is_empty() {
                    backup.entries.retain(|e| !created.contains(&e.key));
                    self.store.save(&backup)?;
                    return Err(TweakError::new(error.code, format!("{} Alle Änderungen dieses Vorgangs wurden zurückgenommen.", error.message)));
                }
                // Sicherung behalten, damit „Wiederherstellen“ den Rest erledigen kann.
                return Err(TweakError::new(
                    error.code,
                    format!("{} Zurücknehmen teilweise fehlgeschlagen: {}", error.message, rollback_failed.join("; ")),
                ));
            }
            written.push(change);
            result.written += 1;
        }
        Ok(result)
    }

    /// Mehrere Tweaks als Einheit: scheitert einer, werden die zuvor angewendeten zurückgesetzt.
    pub fn apply_many(&self, ids: &[TweakId]) -> TweakResult<ApplyResult> {
        let mut total = ApplyResult::default();
        let mut done: Vec<TweakId> = Vec::new();
        for &id in ids {
            let had_backup = !self.store.load()?.entries_for(id).is_empty();
            match self.apply(id) {
                Ok(result) => {
                    total.written += result.written;
                    total.unchanged += result.unchanged;
                    if !had_backup {
                        done.push(id);
                    }
                }
                Err(error) => {
                    for &undo in done.iter().rev() {
                        let _ = self.restore(undo, true);
                    }
                    return Err(error);
                }
            }
        }
        Ok(total)
    }

    // ── Wiederherstellen ─────────────────────────────────────────────

    /// Originalwerte zurückschreiben. Ohne `force` bleiben Werte, die ein anderes
    /// Programm inzwischen geändert hat, unangetastet (und werden gemeldet).
    pub fn restore(&self, id: TweakId, force: bool) -> TweakResult<RestoreResult> {
        let mut backup = self.store.load()?;
        let entries = backup.entries_for(id);
        let mut result = RestoreResult::default();
        if entries.is_empty() {
            return Ok(result);
        }
        if meta(id).needs_admin && !self.admin {
            return Err(TweakError::needs_elevation());
        }
        let (stamp, _) = now_stamp();
        // Sind die gespeicherten Registry-Werte mitgesichert, stellt die App sie selbst
        // her (Originaltyp!) und setzt danach nur noch den Laufzeitwert.
        let has_companions = entries.iter().any(|e| matches!(e.target, Target::Registry { hive: Hive::CurrentUser, .. }));
        for entry in entries {
            let persist = !(has_companions && !matches!(entry.target, Target::Registry { .. }));
            let current = match self.read(&entry.target) {
                Ok(value) => value,
                Err(error) => {
                    result.failures.push(format!("{}: {}", entry.target.label(), error.message));
                    record_failure(&mut backup, &entry, &error.message, &stamp);
                    continue;
                }
            };
            if !force && !current.same(&entry.applied) && !current.same(&entry.original) {
                result.conflicts.push(format!(
                    "{}: von einem anderen Programm auf {} geändert",
                    entry.target.label(),
                    current.display()
                ));
                continue;
            }
            let outcome = if current.same(&entry.original) { Ok(()) } else { self.write_verified(&entry.target, &entry.original, persist) };
            match outcome {
                Ok(()) => {
                    backup.entries.retain(|e| e.key != entry.key);
                    backup.failures.retain(|f| f.key != entry.key);
                    result.restored += 1;
                }
                Err(error) => {
                    result.failures.push(format!("{}: {}", entry.target.label(), error.message));
                    record_failure(&mut backup, &entry, &error.message, &stamp);
                }
            }
        }
        self.store.save(&backup)?;
        Ok(result)
    }

    // ── Zustand ──────────────────────────────────────────────────────

    pub fn state(&self, id: TweakId, backup: &BackupFile) -> (TweakState, bool, bool) {
        let info = meta(id);
        if matches!(info.kind, Kind::Diagnostic | Kind::InGame) {
            return (TweakState::Diagnostic, false, false);
        }
        let changes = match self.plan(id) {
            Ok(changes) => changes,
            Err(error) if error.code == ErrorCode::Unsupported => return (TweakState::Unsupported, false, false),
            Err(_) => return (TweakState::Error, false, false),
        };
        let entries = backup.entries_for(id);
        let at_target = changes.iter().filter(|c| c.current.same(&c.desired)).count();
        if entries.is_empty() {
            return (TweakState::Inactive, false, at_target == changes.len());
        }
        let mut external = false;
        let mut active = 0;
        for change in &changes {
            match entries.iter().find(|e| e.key == change.target.key()) {
                Some(entry) if change.current.same(&entry.applied) => active += 1,
                Some(_) => external = true,
                None => {}
            }
        }
        let state = if active == changes.len() {
            let fresh = entries.iter().any(|e| e.created_at_ms > self.boot_ms);
            if info.needs_restart && fresh { TweakState::PendingRestart } else { TweakState::Active }
        } else if active == 0 {
            TweakState::Inactive
        } else {
            TweakState::PartiallyActive
        };
        let already = entries.iter().all(|e| e.original.same(&e.applied));
        (state, external, already)
    }

    pub fn report(&self, id: TweakId) -> TweakReport {
        let info = meta(id);
        let backup = self.store.load();
        let (state, external_change, already_at_target, error) = match &backup {
            Ok(file) => {
                let (state, external, already) = self.state(id, file);
                (state, external, already, None)
            }
            Err(error) => (TweakState::Error, false, false, Some(error.message.clone())),
        };
        let managed = backup.as_ref().map(|b| !b.entries_for(id).is_empty()).unwrap_or(false);
        let unsupported = match self.plan(id) {
            Err(e) if e.code == ErrorCode::Unsupported && !matches!(info.kind, Kind::Diagnostic | Kind::InGame) => Some(e.message),
            _ => None,
        };
        let failure = backup.as_ref().ok().and_then(|b| b.failures.iter().find(|f| f.tweak == id).map(|f| f.message.clone()));
        TweakReport {
            needs_elevation: info.needs_admin && !self.admin,
            settings: self.settings(id),
            explanation: explanation(id),
            meta: info,
            state,
            unsupported,
            external_change,
            already_at_target,
            managed,
            error: error.or(failure.map(|f| format!("Letzte Wiederherstellung fehlgeschlagen: {f}"))),
        }
    }

    // ── Anzeige der Werte ────────────────────────────────────────────

    fn reg_row(&self, label: &str, hive: Hive, path: &str, name: &str, target: Option<&str>, note: Option<String>) -> SettingRow {
        let current = match self.reg.read(hive, path, name) {
            Ok(Some(value)) => value.display(),
            Ok(None) => "nicht gesetzt".into(),
            Err(error) => format!("nicht lesbar ({})", error.message),
        };
        SettingRow { label: label.into(), current, target: target.map(str::to_string), note }
    }

    fn settings(&self, id: TweakId) -> Vec<SettingRow> {
        let row = |label: &str, current: String, target: Option<&str>, note: Option<&str>| SettingRow {
            label: label.into(),
            current,
            target: target.map(str::to_string),
            note: note.map(str::to_string),
        };
        let unreadable = |e: TweakError| format!("nicht lesbar ({})", e.message);
        match id {
            TweakId::MouseAcceleration => {
                let mouse = self.sys.mouse();
                let precision = match &mouse {
                    Ok([_, _, accel]) => if *accel == 0 { "aus".to_string() } else { "an".to_string() },
                    Err(e) => unreadable(e.clone()),
                };
                vec![
                    row("Zeigerpräzision verbessern", precision, Some("aus"), Some("Windows-Einstellung „Zeigerpräzision verbessern“ = Beschleunigung")),
                    row(
                        "Mausparameter (Schwellen / Beschleunigung)",
                        mouse.map(|m| format!("{} / {} / {}", m[0], m[1], m[2])).unwrap_or_else(unreadable),
                        Some("0 / 0 / 0"),
                        None,
                    ),
                    self.profile_row("MouseSpeed (gespeichert)", MOUSE_KEY, "MouseSpeed", "\"0\""),
                    self.profile_row("MouseThreshold1 (gespeichert)", MOUSE_KEY, "MouseThreshold1", "\"0\""),
                    self.profile_row("MouseThreshold2 (gespeichert)", MOUSE_KEY, "MouseThreshold2", "\"0\""),
                    row(
                        "Zeigergeschwindigkeit",
                        self.sys.mouse_speed().map(|s| format!("{s} von 20")).unwrap_or_else(unreadable),
                        None,
                        Some("Bleibt unverändert"),
                    ),
                    SettingRow {
                        note: Some("Beschleunigungskurve – nur angezeigt, wirkt nur bei eingeschalteter Beschleunigung".into()),
                        ..self.reg_row("SmoothMouseXCurve", Hive::CurrentUser, MOUSE_KEY, "SmoothMouseXCurve", None, None)
                    },
                ]
            }
            TweakId::KeyboardRepeat => vec![
                row("Wiederholrate", self.sys.keyboard_speed().map(|v| format!("{v} von 31")).unwrap_or_else(unreadable), Some("31 (schnellste)"), None),
                row(
                    "Wiederholverzögerung",
                    self.sys.keyboard_delay().map(|v| format!("{v} ({} ms)", 250 * (v + 1))).unwrap_or_else(unreadable),
                    Some("0 (250 ms)"),
                    Some("0 = ca. 250 ms bis zur ersten Wiederholung, 3 = ca. 1 s"),
                ),
                self.profile_row("KeyboardSpeed (gespeichert)", KEYBOARD_KEY, "KeyboardSpeed", "\"31\""),
                self.profile_row("KeyboardDelay (gespeichert)", KEYBOARD_KEY, "KeyboardDelay", "\"0\""),
            ],
            TweakId::KeyboardFilterkeys => match self.sys.filter_keys() {
                Ok(keys) => vec![
                    row("FilterKeys", if keys.flags & FKF_FILTERKEYSON != 0 { "an".into() } else { "aus".into() }, Some("aus"), None),
                    row(
                        "Tastenkürzel (rechte Umschalttaste 8 s)",
                        if keys.flags & FKF_HOTKEYACTIVE != 0 { "aktiv".into() } else { "aus".into() },
                        Some("aus"),
                        Some("Schaltet FilterKeys versehentlich ein, wenn man Umschalt lange hält"),
                    ),
                    row("SlowKeys – Annahme nach", format!("{} ms", keys.wait_ms), None, Some("Taste muss so lange gehalten werden")),
                    row("BounceKeys – Sperre", format!("{} ms", keys.bounce_ms), None, Some("Gleiche Taste so lange ignoriert")),
                    row("RepeatKeys", format!("Start {} ms, Takt {} ms", keys.delay_ms, keys.repeat_ms), None, None),
                ],
                Err(e) => vec![row("FilterKeys", unreadable(e), None, None)],
            },
            TweakId::KeyboardQueue => {
                let mut rows = vec![SettingRow {
                    current: self.queue_display(KBDCLASS_PARAMS, "KeyboardDataQueueSize"),
                    ..row("kbdclass · KeyboardDataQueueSize", String::new(), None, Some("Gilt für alle Tastaturen (USB, Bluetooth, PS/2)"))
                }];
                rows.extend(self.ps2_rows("KeyboardDataQueueSize"));
                rows
            }
            TweakId::MouseQueue => {
                let mut rows = vec![SettingRow {
                    current: self.queue_display(MOUCLASS_PARAMS, "MouseDataQueueSize"),
                    ..row("mouclass · MouseDataQueueSize", String::new(), None, Some("Gilt für alle Mäuse"))
                }];
                rows.extend(self.ps2_rows("MouseDataQueueSize"));
                if self.ps2_service_active() {
                    rows.push(self.reg_row("i8042prt · SampleRate", Hive::LocalMachine, I8042_PARAMS, "SampleRate", None, Some("Abtastrate einer PS/2-Maus".into())));
                }
                rows
            }
            TweakId::MmcssGames => self.mmcss_rows(),
            TweakId::UsbPolling | TweakId::FivemRawInput => Vec::new(),
        }
    }

    /// Im Benutzerprofil gespeicherter Wert – mit Warnung, wenn er nicht als REG_SZ
    /// vorliegt (passiert durch Tweak-Skripte; Windows selbst schreibt Zeichenfolgen).
    fn profile_row(&self, label: &str, path: &str, name: &str, target: &str) -> SettingRow {
        let note = match self.reg.read(Hive::CurrentUser, path, name) {
            Ok(Some(value)) if value.as_text().is_none() => Some(format!(
                "⚠ Als Typ {} gespeichert – Windows erwartet eine Zeichenfolge (REG_SZ). Einschalten speichert sie korrekt, Wiederherstellen setzt den Originaltyp zurück.",
                type_name(value.kind)
            )),
            _ => None,
        };
        self.reg_row(label, Hive::CurrentUser, path, name, Some(target), note)
    }

    fn queue_display(&self, path: &str, name: &str) -> String {
        match self.reg.read(Hive::LocalMachine, path, name) {
            Ok(Some(value)) => match value.as_dword() {
                Some(size) if size == DEFAULT_QUEUE_SIZE => format!("{size} (Windows-Standard)"),
                Some(size) => format!("{size} (Standard wäre {DEFAULT_QUEUE_SIZE})"),
                None => value.display(),
            },
            Ok(None) => format!("nicht gesetzt – Windows nutzt {DEFAULT_QUEUE_SIZE}"),
            Err(error) => format!("nicht lesbar ({})", error.message),
        }
    }

    /// Der PS/2-Treiber ist installiert und nicht deaktiviert (Start ≠ 4).
    fn ps2_service_active(&self) -> bool {
        matches!(self.reg.read(Hive::LocalMachine, I8042_SERVICE, "Start"), Ok(Some(v)) if v.as_dword().is_some_and(|s| s != 4))
    }

    fn ps2_rows(&self, name: &str) -> Vec<SettingRow> {
        if !self.ps2_service_active() {
            return Vec::new();
        }
        vec![self.reg_row(
            &format!("i8042prt · {name}"),
            Hive::LocalMachine,
            I8042_PARAMS,
            name,
            None,
            Some("Nur für PS/2-Geräte – USB-Geräte nutzen diesen Wert nicht".into()),
        )]
    }

    fn mmcss_rows(&self) -> Vec<SettingRow> {
        let responsiveness = self.reg.read(Hive::LocalMachine, MMCSS_PROFILE, "SystemResponsiveness").ok().flatten().and_then(|v| v.as_dword());
        let mut rows = vec![SettingRow {
            note: Some(format!("{} · Die App ändert diesen Wert nie.", responsiveness_meaning(responsiveness))),
            ..self.reg_row("SystemResponsiveness", Hive::LocalMachine, MMCSS_PROFILE, "SystemResponsiveness", None, None)
        }];
        for (name, target, note) in [
            ("Scheduling Category", Some("\"High\""), "High, Medium oder Low"),
            ("Priority", None, "1–8; bei Category „High“ behandelt Windows ihn immer als 2"),
            ("Background Only", None, "True/False"),
            ("BackgroundPriority", None, "1–8"),
            ("Clock Rate", None, "Seit Windows 7 nur noch ein Hinweis"),
            ("GPU Priority", None, "Laut Microsoft nicht verwendet"),
            ("SFIO Priority", None, "Laut Microsoft nicht verwendet"),
        ] {
            let mut row = self.reg_row(name, Hive::LocalMachine, MMCSS_GAMES, name, target, Some(note.into()));
            if let Some(problem) = self.validate_mmcss_value(name) {
                row.note = Some(format!("{note} · ⚠ {problem}"));
            }
            rows.push(row);
        }
        rows
    }

    /// Prüft Datentyp und Wertebereich eines MMCSS-Werts gegen die Microsoft-Doku.
    pub fn validate_mmcss_value(&self, name: &str) -> Option<String> {
        let value = self.reg.read(Hive::LocalMachine, MMCSS_GAMES, name).ok()??;
        let text = |allowed: &[&str]| match value.as_text() {
            Some(t) if allowed.iter().any(|a| a.eq_ignore_ascii_case(&t)) => None,
            Some(t) => Some(format!("„{t}“ ist kein dokumentierter Wert")),
            None => Some("falscher Datentyp (erwartet Zeichenfolge)".to_string()),
        };
        let number = |min: u32, max: u32| match value.as_dword() {
            Some(n) if (min..=max).contains(&n) => None,
            Some(n) => Some(format!("{n} liegt außerhalb von {min}–{max}")),
            None => Some("falscher Datentyp (erwartet DWORD)".to_string()),
        };
        match name {
            "Scheduling Category" => text(&["High", "Medium", "Low"]),
            "Background Only" => text(&["True", "False"]),
            "SFIO Priority" => text(&["Idle", "Low", "Normal", "High"]),
            "Priority" | "BackgroundPriority" => number(1, 8),
            "GPU Priority" => number(0, 31),
            _ => None,
        }
    }
}

fn type_name(kind: u32) -> &'static str {
    match kind {
        1 => "REG_SZ",
        2 => "REG_EXPAND_SZ",
        3 => "REG_BINARY",
        4 => "REG_DWORD",
        7 => "REG_MULTI_SZ",
        11 => "REG_QWORD",
        _ => "unbekannt",
    }
}

/// Bedeutung laut Microsoft: Anteil CPU für Hintergrundaufgaben, in 10er-Schritten.
pub fn responsiveness_meaning(value: Option<u32>) -> String {
    match value {
        None => "Nicht gesetzt – Windows nutzt 20 %".into(),
        Some(100) => "⚠ 100 schaltet MMCSS komplett ab".into(),
        Some(v) if !(10..=100).contains(&v) => format!("{v} liegt außerhalb von 10–100 – Windows behandelt das als 20 %"),
        Some(v) => format!("{} % CPU für Hintergrundaufgaben reserviert", v / 10 * 10),
    }
}

fn validate_range(label: &str, value: u32, min: u32, max: u32) -> TweakResult<()> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(TweakError::invalid(format!("{label}: {value} liegt außerhalb von {min}–{max}.")))
    }
}

fn record_failure(backup: &mut BackupFile, entry: &Entry, message: &str, stamp: &str) {
    backup.failures.retain(|f| f.key != entry.key);
    backup.failures.push(Failure { tweak: entry.tweak, key: entry.key.clone(), message: message.into(), at: stamp.into() });
}

/// Technische Einordnung – ehrlich, ohne Versprechen zu FPS oder Hitreg.
pub fn explanation(id: TweakId) -> Vec<String> {
    let lines: &[&str] = match id {
        TweakId::MouseAcceleration => &[
            "Mit Beschleunigung legt der Zeiger bei schnellen Bewegungen mehr Strecke zurück als bei langsamen. Ohne ist die Strecke nur von der Handbewegung abhängig.",
            "Gesetzt wird über SystemParametersInfo (SPI_SETMOUSE) und dauerhaft im Benutzerprofil gespeichert – genau wie der Haken in der Systemsteuerung.",
            "Spiele mit Raw Input (z. B. FiveM mit Eingabemethode „Raw Input“) lesen die Maus direkt und sind davon nicht betroffen.",
        ],
        TweakId::KeyboardRepeat => &[
            "Betrifft nur gehaltene Tasten: wie schnell Windows ein Zeichen wiederholt und wie lange es vorher wartet.",
            "Die Reaktion auf den ersten Tastendruck – also das Losgehen bei W – wird dadurch nicht schneller.",
            "Spiele lesen gehaltene Bewegungstasten meist als „gedrückt“ und nutzen die Wiederholung gar nicht.",
        ],
        TweakId::KeyboardFilterkeys => &[
            "FilterKeys ist eine Bedienhilfe für Menschen mit Zittern oder unruhigen Händen: Sie ignoriert sehr kurze Anschläge (SlowKeys) oder schnelle Wiederholungen derselben Taste (BounceKeys).",
            "Beim Spielen fühlt sich das wie eine verzögerte oder verschluckte Taste an. Häufig wird sie versehentlich durch 8 s gehaltene rechte Umschalttaste eingeschaltet.",
            "Nicht zu verwechseln mit dem Windows-Feature „Keyboard Filter“ (Unternehmensfunktion zum Sperren von Tastenkombinationen) – das fasst die App nicht an.",
            "Wenn du FilterKeys bewusst nutzt, lass diese Option aus.",
        ],
        TweakId::KeyboardQueue => &[
            "KeyboardDataQueueSize legt fest, wie viele Eingabeereignisse der Treiber zwischenspeichern kann, bevor Windows sie abholt.",
            "Ein kleinerer Puffer macht Eingaben nicht schneller; ist er zu klein, können bei Last Tastendrücke verloren gehen. 100 ist der Windows-Standard.",
            "Deshalb zeigt die App den Wert nur an und ändert ihn nicht.",
        ],
        TweakId::MouseQueue => &[
            "MouseDataQueueSize ist der Zwischenspeicher des Maustreibers – 100 ist der Windows-Standard.",
            "Weniger Puffer bedeutet nicht weniger Verzögerung; zu kleine Werte können Bewegungen verschlucken.",
            "SampleRate gilt nur für PS/2-Mäuse; USB-Mäuse melden ihre Rate selbst.",
        ],
        TweakId::MmcssGames => &[
            "MMCSS hebt Threads an, die sich ausdrücklich für einen Task wie „Games“ anmelden (AvSetMmThreadCharacteristics). Threads ohne Anmeldung bleiben unberührt.",
            "Ob und welche Threads von FiveM sich für „Games“ anmelden, ist nicht dokumentiert – eine Verbesserung ist daher nicht garantiert.",
            "Die App setzt nur „Scheduling Category“ auf High. GPU Priority und SFIO Priority werden laut Microsoft nicht verwendet, Priority wird bei „High“ immer als 2 behandelt, SystemResponsiveness bleibt unverändert.",
            "Braucht Administratorrechte; wirksam nach einem Neustart.",
        ],
        TweakId::UsbPolling => &[
            "Wie oft ein USB-Gerät abgefragt wird, bestimmen Gerät, Firmware, Endpunkt-Beschreibung (bInterval) und Host-Controller.",
            "Eine allgemeine Registry-Einstellung, die jede Maus auf 1000 Hz bringt, gibt es nicht. Ändern lässt sich die Rate nur in der Software des Herstellers (z. B. G HUB, Synapse).",
            "Die Messung zählt die Raw-Input-Meldungen, während du die Maus bewegst – das zeigt die tatsächliche Rate.",
        ],
        TweakId::FivemRawInput => &[
            "FiveM liest die Maus je nach Einstellung über Raw Input, DirectInput oder die Windows-Nachrichten.",
            "Mit Raw Input wirken die Windows-Zeigerbeschleunigung und die Zeigergeschwindigkeit nicht auf das Zielen.",
            "Die Profilwerte (750 Eingabemethode, 754 Empfindlichkeit, 761 Mausglättung) sind nur im Spiel lesbar; von außen ändert die App sie nicht – keine DLL-Injection, kein Speicherzugriff.",
        ],
    };
    lines.iter().map(|l| l.to_string()).collect()
}
