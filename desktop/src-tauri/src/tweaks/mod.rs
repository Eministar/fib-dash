//! „Weitere Sachen → Tweaks“: der WASD Tweak.
//!
//! Aufbau:
//! - `model`     feste Tweak-IDs, Metadaten, Zustände, Fehler
//! - `platform`  Traits für Registry und SystemParametersInfo (in Tests Attrappen)
//! - `backup`    versionierte, atomar geschriebene Sicherung der Originalwerte
//! - `engine`    planen, sichern, anwenden, prüfen, zurückrollen, wiederherstellen
//! - `devices`, `polling`  Geräteerkennung und Messung der Abfragerate (nur lesend)
//! - `elevate`   Helfer mit Administratorrechten, nur für MMCSS
//!
//! Das Fenster kennt nur Tweak-IDs; Pfade und Werte stehen ausschließlich hier.

pub mod backup;
pub mod commands;
pub mod devices;
pub mod elevate;
pub mod engine;
pub mod model;
pub mod platform;
pub mod polling;
pub mod windows_impl;

#[cfg(test)]
mod tests;

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
use serde_json::Value as Json;

use backup::BackupStore;
use elevate::Action;
use engine::{ApplyResult, Engine, PlannedChange, RestoreResult, TweakReport};
use model::{meta, ErrorCode, Kind, RuleStatus, TweakError, TweakId, TweakResult, TweakState};
use platform::{Registry, SystemParams};

pub type Elevator = Box<dyn Fn(Action, TweakId, &Path, bool) -> TweakResult<Json> + Send + Sync>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileItem {
    pub id: TweakId,
    pub name: &'static str,
    pub state: TweakState,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasdStatus {
    pub state: TweakState,
    /// Aktive Einstellungen des Haupt-Toggles.
    pub active_count: usize,
    pub profile_count: usize,
    /// Einstellungen mit gesicherten Originalwerten (alle Tweaks).
    pub managed_count: usize,
    pub pending_restart: bool,
    pub is_admin: bool,
    pub items: Vec<ProfileItem>,
    /// Was der WASD Tweak auf diesem System kann (umschaltbar und unterstützt).
    pub features: Vec<&'static str>,
    /// Funktionen, die Administratorrechte brauchen.
    pub admin_features: Vec<&'static str>,
    /// Der Haupt-Toggle enthält Einstellungen, die das NERO-V-Regelwerk verbietet.
    pub blocked_by_rules: bool,
    /// Wie viele Einstellungen vom Windows-Standard abweichen und laut Regelwerk verboten wären.
    pub forbidden_deviations: Vec<&'static str>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasdDetails {
    pub status: WasdStatus,
    pub tweaks: Vec<TweakReport>,
    pub backup_path: String,
}

fn forbidden(id: TweakId) -> TweakError {
    let info = meta(id);
    TweakError::new(
        ErrorCode::ForbiddenByRules,
        format!("„{}“ ist nach dem NERO-V-Regelwerk verboten ({}). {}", info.name, info.server_rule.paragraphs, info.server_rule.reason),
    )
}

pub struct Service {
    reg: Box<dyn Registry>,
    sys: Box<dyn SystemParams>,
    admin: bool,
    store_path: PathBuf,
    app_version: String,
    boot_ms: u64,
    elevate: Elevator,
    /// Nur ein Vorgang gleichzeitig.
    lock: Mutex<()>,
    /// Läuft gerade „Anwenden“ oder „Wiederherstellen“?
    busy: Mutex<Option<TweakState>>,
}

impl Service {
    pub fn new(reg: Box<dyn Registry>, sys: Box<dyn SystemParams>, admin: bool, store_path: PathBuf, boot_ms: u64, elevate: Elevator) -> Self {
        Self {
            reg,
            sys,
            admin,
            store_path,
            app_version: env!("CARGO_PKG_VERSION").into(),
            boot_ms,
            elevate,
            lock: Mutex::new(()),
            busy: Mutex::new(None),
        }
    }

    /// Echte Windows-Anbindung.
    pub fn windows(store_path: PathBuf) -> Self {
        Self::new(
            Box::new(windows_impl::WinRegistry),
            Box::new(windows_impl::WinSystemParams),
            windows_impl::is_admin(),
            store_path,
            windows_impl::boot_ms(),
            Box::new(elevate::run_elevated),
        )
    }

    fn engine(&self) -> Engine<'_> {
        Engine {
            reg: self.reg.as_ref(),
            sys: self.sys.as_ref(),
            admin: self.admin,
            store: BackupStore::new(self.store_path.clone()),
            app_version: self.app_version.clone(),
            boot_ms: self.boot_ms,
        }
    }

    /// Führt einen Vorgang exklusiv aus und zeigt ihn solange als „busy“ an.
    fn exclusive<T>(&self, state: TweakState, work: impl FnOnce() -> TweakResult<T>) -> TweakResult<T> {
        let Ok(_guard) = self.lock.try_lock() else {
            return Err(TweakError::new(ErrorCode::Busy, "Es läuft schon ein Vorgang – bitte kurz warten."));
        };
        *self.busy.lock().unwrap() = Some(state);
        let result = work();
        *self.busy.lock().unwrap() = None;
        result
    }

    pub fn status(&self) -> WasdStatus {
        let engine = self.engine();
        let backup = engine.store.load();
        let reports: Vec<TweakReport> = TweakId::PROFILE.iter().map(|id| engine.report(*id)).collect();
        let active_count = reports.iter().filter(|r| matches!(r.state, TweakState::Active | TweakState::PendingRestart)).count();
        let any_partial = reports.iter().any(|r| r.state == TweakState::PartiallyActive);
        let mut state = if let Some(busy) = *self.busy.lock().unwrap() {
            busy
        } else if backup.is_err() {
            TweakState::Error
        } else if active_count == reports.len() {
            TweakState::Active
        } else if active_count > 0 || any_partial {
            TweakState::PartiallyActive
        } else if reports.iter().all(|r| r.state == TweakState::Unsupported) {
            TweakState::Unsupported
        } else {
            TweakState::Inactive
        };
        let all: Vec<TweakReport> = TweakId::ALL.iter().map(|id| engine.report(*id)).collect();
        let pending_restart = all.iter().any(|r| r.state == TweakState::PendingRestart);
        if state == TweakState::Active && pending_restart {
            state = TweakState::PendingRestart;
        }
        WasdStatus {
            state,
            active_count,
            profile_count: reports.len(),
            managed_count: backup.as_ref().map(|b| b.entries.len()).unwrap_or(0),
            pending_restart,
            is_admin: self.admin,
            items: reports.iter().map(|r| ProfileItem { id: r.meta.id, name: r.meta.name, state: r.state }).collect(),
            features: all
                .iter()
                .filter(|r| matches!(r.meta.kind, Kind::Toggle | Kind::Experimental) && r.state != TweakState::Unsupported)
                .map(|r| r.meta.name)
                .collect(),
            admin_features: all.iter().filter(|r| r.meta.needs_admin).map(|r| r.meta.name).collect(),
            blocked_by_rules: TweakId::PROFILE.iter().any(|id| meta(*id).server_rule.status == RuleStatus::Forbidden),
            forbidden_deviations: all
                .iter()
                .filter(|r| r.meta.server_rule.status == RuleStatus::Forbidden && r.deviates_from_default == Some(true))
                .map(|r| r.meta.name)
                .collect(),
            error: backup.err().map(|e| e.message),
        }
    }

    pub fn details(&self) -> WasdDetails {
        let engine = self.engine();
        WasdDetails {
            status: self.status(),
            tweaks: TweakId::ALL.iter().map(|id| engine.report(*id)).collect(),
            backup_path: self.store_path.display().to_string(),
        }
    }

    pub fn preview(&self) -> TweakResult<Vec<PlannedChange>> {
        self.engine().preview(&TweakId::PROFILE)
    }

    /// Haupt-Toggle an: nur das risikoarme Profil, nie Experimentelles – und nie,
    /// wenn das NERO-V-Regelwerk eine der Einstellungen verbietet.
    pub fn apply_profile(&self) -> TweakResult<ApplyResult> {
        if let Some(id) = TweakId::PROFILE.into_iter().find(|id| meta(*id).server_rule.status == RuleStatus::Forbidden) {
            return Err(forbidden(id));
        }
        self.exclusive(TweakState::Applying, || self.engine().apply_many(&TweakId::PROFILE))
    }

    /// „Windows-Standard herstellen“ – z. B. um nach einem früheren Tweak regelkonform zu werden.
    pub fn reset_to_default(&self, id: TweakId) -> TweakResult<ApplyResult> {
        self.exclusive(TweakState::Applying, || self.engine().apply_default(id))
    }

    /// Haupt-Toggle aus: Originalwerte der Profil-Einstellungen zurück.
    pub fn restore_profile(&self, force: bool) -> TweakResult<RestoreResult> {
        self.exclusive(TweakState::Restoring, || {
            let engine = self.engine();
            let mut total = RestoreResult::default();
            for id in TweakId::PROFILE {
                let result = engine.restore(id, force)?;
                total.restored += result.restored;
                total.conflicts.extend(result.conflicts);
                total.failures.extend(result.failures);
            }
            Ok(total)
        })
    }

    fn elevated<T: serde::de::DeserializeOwned>(&self, action: Action, id: TweakId, force: bool) -> TweakResult<T> {
        let value = (self.elevate)(action, id, &self.store_path, force)?;
        serde_json::from_value(value).map_err(|e| TweakError::os(format!("Antwort des Helfers: {e}")))
    }

    /// Einzelner Tweak; braucht er Adminrechte, übernimmt der Helfer (mit UAC-Abfrage).
    /// Tweaks „auf eigene Gefahr“ laufen nur mit `confirmed = true` – das prüft das
    /// Backend, damit die Warnung nicht übergangen werden kann.
    pub fn apply(&self, id: TweakId, confirmed: bool) -> TweakResult<ApplyResult> {
        let info = meta(id);
        if info.server_rule.status == RuleStatus::Forbidden {
            return Err(forbidden(id));
        }
        if info.server_rule.status == RuleStatus::TicketRequired && !confirmed {
            return Err(TweakError::new(
                ErrorCode::ConfirmationRequired,
                format!("„{}“ darf auf NERO-V nur nach Freigabe per Analyse-Ticket genutzt werden ({}).", info.name, info.server_rule.paragraphs),
            ));
        }
        if info.own_risk && !confirmed {
            return Err(TweakError::new(
                ErrorCode::ConfirmationRequired,
                format!("„{}“ ist eine Benutzung auf eigene Gefahr und muss vor dem Einschalten bestätigt werden.", info.name),
            ));
        }
        self.exclusive(TweakState::Applying, || {
            if meta(id).needs_admin && !self.admin {
                // Vorab prüfen, was ohne Rechte geht – kein UAC-Fenster für Unmögliches.
                self.engine().plan(id)?;
                return self.elevated(Action::Apply, id, false);
            }
            self.engine().apply(id)
        })
    }

    pub fn restore(&self, id: TweakId, force: bool) -> TweakResult<RestoreResult> {
        self.exclusive(TweakState::Restoring, || self.restore_inner(id, force))
    }

    fn restore_inner(&self, id: TweakId, force: bool) -> TweakResult<RestoreResult> {
        let engine = self.engine();
        let managed = !engine.store.load()?.entries_for(id).is_empty();
        if managed && meta(id).needs_admin && !self.admin {
            return self.elevated(Action::Restore, id, force);
        }
        engine.restore(id, force)
    }

    /// „Alle Änderungen rückgängig machen“ – ausschließlich, was die App verwaltet.
    pub fn restore_all(&self, force: bool) -> TweakResult<RestoreResult> {
        self.exclusive(TweakState::Restoring, || {
            let backup = self.engine().store.load()?;
            let mut total = RestoreResult::default();
            for id in TweakId::ALL.into_iter().filter(|id| backup.entries.iter().any(|e| e.tweak == *id)) {
                match self.restore_inner(id, force) {
                    Ok(result) => {
                        total.restored += result.restored;
                        total.conflicts.extend(result.conflicts);
                        total.failures.extend(result.failures);
                    }
                    Err(error) => total.failures.push(format!("{}: {}", meta(id).name, error.message)),
                }
            }
            Ok(total)
        })
    }
}
