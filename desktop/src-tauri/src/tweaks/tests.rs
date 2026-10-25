//! Tests mit Attrappen für Registry und SystemParametersInfo – sie verändern
//! keine echten Einstellungen dieses Rechners. Die Sicherung liegt im Temp-Ordner.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
};

use super::backup::{BackupStore, Target, Value};
use super::elevate::Action;
use super::engine::{Engine, KEYBOARD_KEY, MMCSS_GAMES, MOUSE_KEY};
use super::model::{ErrorCode, TweakId, TweakResult, TweakState};
use super::platform::{FilterKeys, Hive, RegValue, Registry, SystemParams, FKF_AVAILABLE, FKF_FILTERKEYSON, FKF_HOTKEYACTIVE};
use super::{Elevator, Service};
use crate::tweaks::model::TweakError;

// ── Attrappen ────────────────────────────────────────────────────────

struct FakeRegistry {
    keys: Mutex<HashSet<(Hive, String)>>,
    values: Mutex<HashMap<(Hive, String, String), RegValue>>,
    /// HKLM-Schreibzugriffe ohne Adminrechte verweigern.
    deny_machine_writes: AtomicBool,
}

impl Default for FakeRegistry {
    /// Benutzerprofil wie bei einer frischen Windows-Installation.
    fn default() -> Self {
        let reg = FakeRegistry { keys: Mutex::default(), values: Mutex::default(), deny_machine_writes: AtomicBool::new(false) };
        for (name, value) in [("MouseSpeed", "1"), ("MouseThreshold1", "6"), ("MouseThreshold2", "10")] {
            reg.set(Hive::CurrentUser, MOUSE_KEY, name, RegValue::sz(value));
        }
        reg.set(Hive::CurrentUser, KEYBOARD_KEY, "KeyboardSpeed", RegValue::sz("31"));
        reg.set(Hive::CurrentUser, KEYBOARD_KEY, "KeyboardDelay", RegValue::sz("1"));
        reg
    }
}

impl FakeRegistry {
    fn with_mmcss(category: Option<&str>) -> Self {
        let reg = FakeRegistry::default();
        reg.keys.lock().unwrap().insert((Hive::LocalMachine, MMCSS_GAMES.into()));
        if let Some(category) = category {
            reg.set(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category", RegValue::sz(category));
        }
        reg.set(Hive::LocalMachine, MMCSS_GAMES, "Priority", RegValue::dword(2));
        reg
    }

    fn set(&self, hive: Hive, path: &str, name: &str, value: RegValue) {
        self.keys.lock().unwrap().insert((hive, path.into()));
        self.values.lock().unwrap().insert((hive, path.into(), name.into()), value);
    }

    fn get(&self, hive: Hive, path: &str, name: &str) -> Option<RegValue> {
        self.values.lock().unwrap().get(&(hive, path.into(), name.into())).cloned()
    }
}

impl Registry for FakeRegistry {
    fn key_exists(&self, hive: Hive, path: &str) -> TweakResult<bool> {
        Ok(self.keys.lock().unwrap().contains(&(hive, path.to_string())))
    }
    fn read(&self, hive: Hive, path: &str, name: &str) -> TweakResult<Option<RegValue>> {
        Ok(self.get(hive, path, name))
    }
    fn write(&self, hive: Hive, path: &str, name: &str, value: &RegValue) -> TweakResult<()> {
        if hive == Hive::LocalMachine && self.deny_machine_writes.load(Ordering::SeqCst) {
            return Err(TweakError::new(ErrorCode::NeedsElevation, "Zugriff verweigert"));
        }
        if !self.keys.lock().unwrap().contains(&(hive, path.to_string())) {
            return Err(TweakError::os("Schlüssel fehlt"));
        }
        self.values.lock().unwrap().insert((hive, path.into(), name.into()), value.clone());
        Ok(())
    }
    fn delete(&self, hive: Hive, path: &str, name: &str) -> TweakResult<()> {
        self.values.lock().unwrap().remove(&(hive, path.into(), name.into()));
        Ok(())
    }
}

struct FakeSystem {
    mouse: Mutex<[i32; 3]>,
    speed: AtomicU32,
    delay: AtomicU32,
    filter: Mutex<FilterKeys>,
    /// Simuliert einen Fehler beim Setzen der Verzögerung.
    fail_delay: AtomicBool,
    /// Windows nimmt die Rate an, setzt aber einen anderen Wert (Prüfung muss das merken).
    clamp_speed_to: Mutex<Option<u32>>,
    /// Wie Windows: mit „persist“ landen die Mauswerte als REG_SZ in der Registry.
    mirror: Mutex<Option<Arc<FakeRegistry>>>,
}

impl Default for FakeSystem {
    fn default() -> Self {
        // Windows-Standard: Zeigerpräzision an, Rate 31, Verzögerung 1.
        Self {
            mouse: Mutex::new([6, 10, 1]),
            speed: AtomicU32::new(31),
            delay: AtomicU32::new(1),
            filter: Mutex::new(FilterKeys { flags: FKF_AVAILABLE | FKF_HOTKEYACTIVE, wait_ms: 1000, delay_ms: 1000, repeat_ms: 500, bounce_ms: 0 }),
            fail_delay: AtomicBool::new(false),
            clamp_speed_to: Mutex::new(None),
            mirror: Mutex::new(None),
        }
    }
}

impl SystemParams for FakeSystem {
    fn mouse(&self) -> TweakResult<[i32; 3]> {
        Ok(*self.mouse.lock().unwrap())
    }
    fn set_mouse(&self, value: [i32; 3], persist: bool) -> TweakResult<()> {
        *self.mouse.lock().unwrap() = value;
        if let (true, Some(reg)) = (persist, self.mirror.lock().unwrap().as_ref()) {
            for (name, v) in [("MouseThreshold1", value[0]), ("MouseThreshold2", value[1]), ("MouseSpeed", value[2])] {
                reg.set(Hive::CurrentUser, MOUSE_KEY, name, RegValue::sz(&v.to_string()));
            }
        }
        Ok(())
    }
    fn mouse_speed(&self) -> TweakResult<u32> {
        Ok(10)
    }
    fn keyboard_speed(&self) -> TweakResult<u32> {
        Ok(self.speed.load(Ordering::SeqCst))
    }
    fn set_keyboard_speed(&self, value: u32, _persist: bool) -> TweakResult<()> {
        let value = self.clamp_speed_to.lock().unwrap().unwrap_or(value);
        self.speed.store(value, Ordering::SeqCst);
        Ok(())
    }
    fn keyboard_delay(&self) -> TweakResult<u32> {
        Ok(self.delay.load(Ordering::SeqCst))
    }
    fn set_keyboard_delay(&self, value: u32, _persist: bool) -> TweakResult<()> {
        if self.fail_delay.load(Ordering::SeqCst) {
            return Err(TweakError::os("SystemParametersInfo fehlgeschlagen"));
        }
        self.delay.store(value, Ordering::SeqCst);
        Ok(())
    }
    fn filter_keys(&self) -> TweakResult<FilterKeys> {
        Ok(*self.filter.lock().unwrap())
    }
    fn set_filter_keys(&self, value: FilterKeys) -> TweakResult<()> {
        *self.filter.lock().unwrap() = value;
        Ok(())
    }
}

fn temp_store(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fib-tweaks-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("tweaks-backup.json")
}

fn engine<'a>(reg: &'a FakeRegistry, sys: &'a FakeSystem, admin: bool, path: &PathBuf) -> Engine<'a> {
    Engine { reg, sys, admin, store: BackupStore::new(path.clone()), app_version: "test".into(), boot_ms: 0 }
}

// ── Registry-Werte ───────────────────────────────────────────────────

#[test]
fn registry_values_keep_type_and_compare_text_tolerantly() {
    let sz = RegValue::sz("High");
    assert_eq!(sz.kind, 1);
    assert_eq!(sz.as_text().as_deref(), Some("High"));
    // Dieselbe Zeichenfolge mit zusätzlichen Nullen gilt als gleich, andere Typen nie.
    let padded = RegValue { kind: 1, data: [sz.data.clone(), vec![0, 0]].concat() };
    assert!(sz.same(&padded));
    assert!(!sz.same(&RegValue::dword(2)));
    assert_eq!(RegValue::dword(6).as_dword(), Some(6));
    assert_eq!(RegValue::dword(6).display(), "6");
}

// ── Sichern und Wiederherstellen ─────────────────────────────────────

#[test]
fn original_is_backed_up_before_change_and_never_overwritten() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("original"));
    let e = engine(&reg, &sys, false, &path);
    e.apply(TweakId::MouseAcceleration).unwrap();
    assert_eq!(*sys.mouse.lock().unwrap(), [0, 0, 0]);

    // Jemand schaltet zwischendurch zurück, die App aktiviert erneut: Original bleibt [6, 10, 1].
    *sys.mouse.lock().unwrap() = [6, 10, 1];
    e.apply(TweakId::MouseAcceleration).unwrap();
    let backup = e.store.load().unwrap();
    let entry = backup.entry(&Target::Mouse.key()).unwrap();
    assert_eq!(entry.original, Value::Mouse([6, 10, 1]));
    assert_eq!(backup.entries.len(), 4, "Laufzeitwert plus drei gespeicherte Registry-Werte");

    e.restore(TweakId::MouseAcceleration, false).unwrap();
    assert_eq!(*sys.mouse.lock().unwrap(), [6, 10, 1]);
    assert!(e.store.load().unwrap().entries.is_empty());
}

#[test]
fn missing_registry_value_is_restored_as_missing() {
    let (reg, sys, path) = (FakeRegistry::with_mmcss(None), FakeSystem::default(), temp_store("missing"));
    let e = engine(&reg, &sys, true, &path);
    e.apply(TweakId::MmcssGames).unwrap();
    assert_eq!(reg.get(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category"), Some(RegValue::sz("High")));
    e.restore(TweakId::MmcssGames, false).unwrap();
    assert_eq!(reg.get(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category"), None, "fehlte vorher, muss wieder fehlen");
    // Andere Werte bleiben unberührt.
    assert_eq!(reg.get(Hive::LocalMachine, MMCSS_GAMES, "Priority"), Some(RegValue::dword(2)));
}

#[test]
fn repeated_apply_and_restore_are_idempotent() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("repeat"));
    let e = engine(&reg, &sys, false, &path);
    let first = e.apply(TweakId::KeyboardRepeat).unwrap();
    assert_eq!((first.written, first.unchanged), (2, 2), "Rate war schon 31, nur die Verzögerung (Registry + Laufzeit) ändert sich");
    let second = e.apply(TweakId::KeyboardRepeat).unwrap();
    assert_eq!(second.written, 0);
    assert_eq!(e.restore(TweakId::KeyboardRepeat, false).unwrap().restored, 4);
    assert_eq!(e.restore(TweakId::KeyboardRepeat, false).unwrap().restored, 0);
    assert_eq!((sys.speed.load(Ordering::SeqCst), sys.delay.load(Ordering::SeqCst)), (31, 1));
}

#[test]
fn partial_failure_rolls_back_everything_from_this_run() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("partial"));
    sys.speed.store(20, Ordering::SeqCst);
    sys.fail_delay.store(true, Ordering::SeqCst);
    let e = engine(&reg, &sys, false, &path);
    let error = e.apply(TweakId::KeyboardRepeat).unwrap_err();
    assert!(error.message.contains("zurückgenommen"), "{}", error.message);
    assert_eq!(sys.speed.load(Ordering::SeqCst), 20, "Rate wurde auf den alten Wert zurückgesetzt");
    assert!(e.store.load().unwrap().entries.is_empty(), "keine halbe Sicherung zurückgelassen");
}

#[test]
fn verification_catches_values_windows_did_not_accept() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("verify"));
    sys.speed.store(20, Ordering::SeqCst);
    *sys.clamp_speed_to.lock().unwrap() = Some(25);
    let e = engine(&reg, &sys, false, &path);
    let error = e.apply(TweakId::KeyboardRepeat).unwrap_err();
    assert_eq!(error.code, ErrorCode::Verify);
}

#[test]
fn invalid_values_are_rejected() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("invalid"));
    let e = engine(&reg, &sys, false, &path);
    // Eine manipulierte Sicherung mit unmöglichem Originalwert wird beim Wiederherstellen abgelehnt.
    e.apply(TweakId::KeyboardRepeat).unwrap();
    let mut backup = e.store.load().unwrap();
    backup.entries.iter_mut().find(|x| x.target == Target::KeyboardSpeed).unwrap().original = Value::Number(40);
    e.store.save(&backup).unwrap();
    let result = e.restore(TweakId::KeyboardRepeat, false).unwrap();
    assert_eq!(result.failures.len(), 1, "{result:?}");
    assert!(result.failures[0].contains("außerhalb"));
    // Typ passt nicht zum Ziel → Sicherung gilt als beschädigt.
    let mut broken = e.store.load().unwrap();
    broken.entries[0].original = Value::Mouse([0, 0, 0]);
    assert!(broken.validate().is_err());
}

#[test]
fn machine_settings_need_admin_and_touch_nothing_without() {
    let (reg, sys, path) = (FakeRegistry::with_mmcss(Some("Medium")), FakeSystem::default(), temp_store("admin"));
    reg.deny_machine_writes.store(true, Ordering::SeqCst);
    let e = engine(&reg, &sys, false, &path);
    assert_eq!(e.apply(TweakId::MmcssGames).unwrap_err().code, ErrorCode::NeedsElevation);
    assert_eq!(reg.get(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category"), Some(RegValue::sz("Medium")));
    assert!(!path.exists(), "ohne Rechte keine Sicherung angelegt");
}

#[test]
fn unsupported_system_is_reported() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("unsupported"));
    let e = engine(&reg, &sys, true, &path);
    let backup = e.store.load().unwrap();
    assert_eq!(e.state(TweakId::MmcssGames, &backup).0, TweakState::Unsupported);
    assert_eq!(e.apply(TweakId::MmcssGames).unwrap_err().code, ErrorCode::Unsupported);
    // Unerwarteter Datentyp ebenso.
    let reg = FakeRegistry::with_mmcss(None);
    reg.set(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category", RegValue::dword(1));
    assert_eq!(engine(&reg, &sys, true, &path).apply(TweakId::MmcssGames).unwrap_err().code, ErrorCode::Unsupported);
    // Reine Anzeigen lassen sich nie anwenden.
    assert_eq!(e.apply(TweakId::KeyboardQueue).unwrap_err().code, ErrorCode::Unsupported);
}

#[test]
fn external_changes_are_detected_and_kept_unless_forced() {
    let reg = Arc::new(FakeRegistry::default());
    let sys = FakeSystem::default();
    *sys.mirror.lock().unwrap() = Some(reg.clone());
    let path = temp_store("external");
    let e = engine(&reg, &sys, false, &path);
    e.apply(TweakId::MouseAcceleration).unwrap();
    // Ein anderes Programm (z. B. die Systemsteuerung) stellt eigene Werte ein – Laufzeit und Registry.
    sys.set_mouse([4, 8, 2], true).unwrap();
    let backup = e.store.load().unwrap();
    let (state, external, _, _) = e.state(TweakId::MouseAcceleration, &backup);
    assert_eq!((state, external), (TweakState::Inactive, true));

    let result = e.restore(TweakId::MouseAcceleration, false).unwrap();
    assert_eq!(result.conflicts.len(), 4, "{result:?}");
    assert_eq!(*sys.mouse.lock().unwrap(), [4, 8, 2], "fremde Änderung bleibt");
    let forced = e.restore(TweakId::MouseAcceleration, true).unwrap();
    assert_eq!(forced.restored, 4);
    assert_eq!(*sys.mouse.lock().unwrap(), [6, 10, 1]);
    assert_eq!(reg.get(Hive::CurrentUser, MOUSE_KEY, "MouseSpeed"), Some(RegValue::sz("1")));
}

#[test]
fn setting_already_at_target_is_not_reset_to_a_default() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("already"));
    *sys.mouse.lock().unwrap() = [0, 0, 0];
    for name in ["MouseSpeed", "MouseThreshold1", "MouseThreshold2"] {
        reg.set(Hive::CurrentUser, MOUSE_KEY, name, RegValue::sz("0"));
    }
    let e = engine(&reg, &sys, false, &path);
    assert!(e.state(TweakId::MouseAcceleration, &e.store.load().unwrap()).2, "schon am Ziel erkannt");
    e.apply(TweakId::MouseAcceleration).unwrap();
    e.restore(TweakId::MouseAcceleration, false).unwrap();
    assert_eq!(*sys.mouse.lock().unwrap(), [0, 0, 0], "nicht auf den Windows-Standard [6,10,1] gesetzt");
}

#[test]
fn filterkeys_only_switches_flags_and_keeps_timings() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("filterkeys"));
    *sys.filter.lock().unwrap() = FilterKeys { flags: FKF_FILTERKEYSON | FKF_AVAILABLE | FKF_HOTKEYACTIVE, wait_ms: 500, delay_ms: 700, repeat_ms: 300, bounce_ms: 400 };
    let e = engine(&reg, &sys, false, &path);
    e.apply(TweakId::KeyboardFilterkeys).unwrap();
    let now = *sys.filter.lock().unwrap();
    assert_eq!(now.flags, FKF_AVAILABLE);
    assert_eq!((now.wait_ms, now.delay_ms, now.repeat_ms, now.bounce_ms), (500, 700, 300, 400));
    e.restore(TweakId::KeyboardFilterkeys, false).unwrap();
    assert_eq!(sys.filter.lock().unwrap().flags, FKF_FILTERKEYSON | FKF_AVAILABLE | FKF_HOTKEYACTIVE);
}

#[test]
fn backup_survives_restart_and_corrupt_files_are_never_overwritten() {
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("persist"));
    engine(&reg, &sys, false, &path).apply(TweakId::MouseAcceleration).unwrap();
    // „Neustart“: neue Engine, neue Store-Instanz, gleiche Datei.
    let restarted = engine(&reg, &sys, false, &path);
    let backup = restarted.store.load().unwrap();
    assert_eq!(restarted.state(TweakId::MouseAcceleration, &backup).0, TweakState::Active);
    assert_eq!(restarted.restore(TweakId::MouseAcceleration, false).unwrap().restored, 4);

    std::fs::write(&path, "{ kaputt").unwrap();
    let error = restarted.apply(TweakId::MouseAcceleration).unwrap_err();
    assert_eq!(error.code, ErrorCode::Backup);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ kaputt", "kaputte Sicherung bleibt zur Rettung erhalten");
    assert_eq!(*sys.mouse.lock().unwrap(), [6, 10, 1], "ohne gültige Sicherung wird nichts geändert");
}

#[test]
fn mmcss_change_waits_for_restart() {
    let (reg, sys, path) = (FakeRegistry::with_mmcss(Some("Medium")), FakeSystem::default(), temp_store("restart"));
    let e = engine(&reg, &sys, true, &path);
    e.apply(TweakId::MmcssGames).unwrap();
    assert_eq!(e.state(TweakId::MmcssGames, &e.store.load().unwrap()).0, TweakState::PendingRestart);
    // Nach einem Neustart (Systemstart später als die Änderung) gilt er als aktiv.
    let after_boot = Engine { boot_ms: u64::MAX, ..engine(&reg, &sys, true, &path) };
    assert_eq!(after_boot.state(TweakId::MmcssGames, &after_boot.store.load().unwrap()).0, TweakState::Active);
}

#[test]
fn mmcss_values_are_validated_against_microsoft_docs() {
    let (reg, sys, path) = (FakeRegistry::with_mmcss(Some("Turbo")), FakeSystem::default(), temp_store("mmcss-validate"));
    reg.set(Hive::LocalMachine, MMCSS_GAMES, "Priority", RegValue::dword(9));
    reg.set(Hive::LocalMachine, MMCSS_GAMES, "GPU Priority", RegValue::sz("8"));
    let e = engine(&reg, &sys, true, &path);
    assert!(e.validate_mmcss_value("Scheduling Category").unwrap().contains("kein dokumentierter Wert"));
    assert!(e.validate_mmcss_value("Priority").unwrap().contains("außerhalb"));
    assert!(e.validate_mmcss_value("GPU Priority").unwrap().contains("Datentyp"));
    assert_eq!(e.validate_mmcss_value("Background Only"), None, "fehlender Wert ist kein Fehler");
}

// ── Dienst (wie über die Tauri-Befehle) ──────────────────────────────

fn service(name: &str, admin: bool, elevate: Elevator) -> (Service, Arc<FakeRegistry>, Arc<FakeSystem>, PathBuf) {
    struct Shared<T>(Arc<T>);
    impl Registry for Shared<FakeRegistry> {
        fn key_exists(&self, h: Hive, p: &str) -> TweakResult<bool> { self.0.key_exists(h, p) }
        fn read(&self, h: Hive, p: &str, n: &str) -> TweakResult<Option<RegValue>> { self.0.read(h, p, n) }
        fn write(&self, h: Hive, p: &str, n: &str, v: &RegValue) -> TweakResult<()> { self.0.write(h, p, n, v) }
        fn delete(&self, h: Hive, p: &str, n: &str) -> TweakResult<()> { self.0.delete(h, p, n) }
    }
    impl SystemParams for Shared<FakeSystem> {
        fn mouse(&self) -> TweakResult<[i32; 3]> { self.0.mouse() }
        fn set_mouse(&self, v: [i32; 3], p: bool) -> TweakResult<()> { self.0.set_mouse(v, p) }
        fn mouse_speed(&self) -> TweakResult<u32> { self.0.mouse_speed() }
        fn keyboard_speed(&self) -> TweakResult<u32> { self.0.keyboard_speed() }
        fn set_keyboard_speed(&self, v: u32, p: bool) -> TweakResult<()> { self.0.set_keyboard_speed(v, p) }
        fn keyboard_delay(&self) -> TweakResult<u32> { self.0.keyboard_delay() }
        fn set_keyboard_delay(&self, v: u32, p: bool) -> TweakResult<()> { self.0.set_keyboard_delay(v, p) }
        fn filter_keys(&self) -> TweakResult<FilterKeys> { self.0.filter_keys() }
        fn set_filter_keys(&self, v: FilterKeys) -> TweakResult<()> { self.0.set_filter_keys(v) }
    }
    let reg = Arc::new(FakeRegistry::with_mmcss(Some("Medium")));
    let sys = Arc::new(FakeSystem::default());
    let path = temp_store(name);
    let service = Service::new(Box::new(Shared(reg.clone())), Box::new(Shared(sys.clone())), admin, path.clone(), 0, elevate);
    (service, reg, sys, path)
}

fn no_elevation() -> Elevator {
    Box::new(|_, _, _, _| Err(TweakError::new(ErrorCode::ElevationDenied, "abgelehnt")))
}

#[test]
fn main_toggle_is_blocked_by_nerov_rules_and_changes_nothing() {
    let (service, _, sys, _) = service("profile", false, no_elevation());
    let status = service.status();
    assert!(status.blocked_by_rules);
    let error = service.apply_profile().unwrap_err();
    assert_eq!(error.code, ErrorCode::ForbiddenByRules);
    assert!(error.message.contains("§ 4.5"), "{}", error.message);
    assert_eq!(*sys.mouse.lock().unwrap(), [6, 10, 1]);
    assert_eq!(service.status().managed_count, 0);
}

#[test]
fn forbidden_tweaks_cannot_be_enabled_even_with_confirmation() {
    let (service, _, sys, _) = service("forbidden", false, no_elevation());
    for id in [TweakId::MouseAcceleration, TweakId::KeyboardRepeat] {
        assert_eq!(service.apply(id, true).unwrap_err().code, ErrorCode::ForbiddenByRules);
    }
    assert_eq!((*sys.mouse.lock().unwrap(), sys.delay.load(Ordering::SeqCst)), ([6, 10, 1], 1));
}

#[test]
fn engine_keeps_profile_rollback_semantics_for_future_profiles() {
    // Die Engine selbst kennt kein Regelwerk; apply_many rollt weiterhin vollständig zurück.
    let (reg, sys, path) = (FakeRegistry::default(), FakeSystem::default(), temp_store("profile-fail"));
    sys.fail_delay.store(true, Ordering::SeqCst);
    let e = engine(&reg, &sys, false, &path);
    assert!(e.apply_many(&[TweakId::MouseAcceleration, TweakId::KeyboardRepeat]).is_err());
    assert_eq!(*sys.mouse.lock().unwrap(), [6, 10, 1], "Mausbeschleunigung wurde wieder eingeschaltet");
    assert!(e.store.load().unwrap().entries.is_empty());
}

#[test]
fn windows_default_can_be_restored_and_undone() {
    // Nach einem früheren Tweak-Skript: Beschleunigung aus, Werte als DWORD.
    let reg = Arc::new(FakeRegistry::default());
    for name in ["MouseSpeed", "MouseThreshold1", "MouseThreshold2"] {
        reg.set(Hive::CurrentUser, MOUSE_KEY, name, RegValue::dword(0));
    }
    let sys = FakeSystem::default();
    *sys.mouse.lock().unwrap() = [0, 0, 0];
    *sys.mirror.lock().unwrap() = Some(reg.clone());
    let path = temp_store("default");
    let e = engine(&reg, &sys, false, &path);
    assert_eq!(e.report(TweakId::MouseAcceleration).deviates_from_default, Some(true));

    e.apply_default(TweakId::MouseAcceleration).unwrap();
    assert_eq!(*sys.mouse.lock().unwrap(), [6, 10, 1]);
    assert_eq!(reg.get(Hive::CurrentUser, MOUSE_KEY, "MouseThreshold2"), Some(RegValue::sz("10")));
    let report = e.report(TweakId::MouseAcceleration);
    assert_eq!((report.state, report.windows_default_set, report.deviates_from_default), (TweakState::Inactive, true, Some(false)));

    // Rückgängig: exakt der vorherige Zustand inklusive Datentyp.
    e.restore(TweakId::MouseAcceleration, false).unwrap();
    assert_eq!(*sys.mouse.lock().unwrap(), [0, 0, 0]);
    assert_eq!(reg.get(Hive::CurrentUser, MOUSE_KEY, "MouseSpeed"), Some(RegValue::dword(0)));
}

#[test]
fn ticket_tweaks_need_confirmation_and_rules_are_documented() {
    use super::model::{meta, RuleStatus};
    let (service, _, sys, _) = service("ticket", false, no_elevation());
    *sys.filter.lock().unwrap() = FilterKeys { flags: FKF_FILTERKEYSON, ..FilterKeys::default() };
    assert_eq!(meta(TweakId::KeyboardFilterkeys).server_rule.status, RuleStatus::TicketRequired);
    assert_eq!(service.apply(TweakId::KeyboardFilterkeys, false).unwrap_err().code, ErrorCode::ConfirmationRequired);
    service.apply(TweakId::KeyboardFilterkeys, true).unwrap();
    for id in TweakId::ALL {
        let rule = meta(id).server_rule;
        assert!(!rule.reason.is_empty() && !rule.paragraphs.is_empty(), "{id:?} ohne Begründung");
    }
}

#[test]
fn admin_tweak_goes_through_the_helper_and_reports_denial() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = calls.clone();
    let elevate: Elevator = Box::new(move |action, id, _, _| {
        seen.lock().unwrap().push((action, id));
        Err(TweakError::new(ErrorCode::ElevationDenied, "abgelehnt"))
    });
    let (service, reg, _, _) = service("helper", false, elevate);
    let error = service.apply(TweakId::MmcssGames, true).unwrap_err();
    assert_eq!(error.code, ErrorCode::ElevationDenied);
    assert_eq!(*calls.lock().unwrap(), vec![(Action::Apply, TweakId::MmcssGames)]);
    assert_eq!(reg.get(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category"), Some(RegValue::sz("Medium")));
    // Benutzer-Einstellungen brauchen den Helfer nie.
    service.reset_to_default(TweakId::MouseAcceleration).unwrap();
    assert_eq!(calls.lock().unwrap().len(), 1);
}

#[test]
fn restore_all_only_touches_managed_settings() {
    let (service, _, sys, _) = service("restore-all", true, no_elevation());
    *sys.mouse.lock().unwrap() = [0, 0, 0];
    service.reset_to_default(TweakId::MouseAcceleration).unwrap();
    service.apply(TweakId::MmcssGames, true).unwrap();
    // Nicht von der App verwaltet – muss unverändert bleiben.
    sys.speed.store(12, Ordering::SeqCst);
    let result = service.restore_all(false).unwrap();
    assert_eq!(result.restored, 5, "Maus (4 Werte) und MMCSS (1 Wert)");
    assert_eq!(sys.speed.load(Ordering::SeqCst), 12);
    assert_eq!(service.status().managed_count, 0);
}

#[test]
fn own_risk_tweaks_need_explicit_confirmation() {
    let (service, reg, sys, _) = service("own-risk", true, no_elevation());
    *sys.filter.lock().unwrap() = FilterKeys { flags: FKF_FILTERKEYSON | FKF_HOTKEYACTIVE, ..FilterKeys::default() };
    for id in [TweakId::MmcssGames, TweakId::KeyboardFilterkeys] {
        assert!(super::model::meta(id).own_risk && super::model::meta(id).risk_notice.is_some());
        assert_eq!(service.apply(id, false).unwrap_err().code, ErrorCode::ConfirmationRequired);
    }
    // Ohne Bestätigung hat sich nichts geändert.
    assert_eq!(reg.get(Hive::LocalMachine, MMCSS_GAMES, "Scheduling Category"), Some(RegValue::sz("Medium")));
    assert_eq!(sys.filter.lock().unwrap().flags, FKF_FILTERKEYSON | FKF_HOTKEYACTIVE);
    assert_eq!(service.status().managed_count, 0);
    // Mit Bestätigung geht es.
    service.apply(TweakId::KeyboardFilterkeys, true).unwrap();
    assert!(!super::model::meta(TweakId::MouseAcceleration).own_risk);
}

/// Nur lesend gegen das echte System: `cargo test -- --ignored reads_real_system --nocapture`.
#[test]
#[ignore]
fn reads_real_system_without_changing_anything() {
    use super::windows_impl::{boot_ms, is_admin, WinRegistry, WinSystemParams};
    let path = temp_store("real-readonly");
    let e = Engine { reg: &WinRegistry, sys: &WinSystemParams, admin: is_admin(), store: BackupStore::new(path.clone()), app_version: "test".into(), boot_ms: boot_ms() };
    for id in TweakId::ALL {
        let report = e.report(id);
        println!("\n## {} – {:?}{}", report.meta.name, report.state, if report.already_at_target { " (schon am Ziel)" } else { "" });
        if let Some(reason) = &report.unsupported {
            println!("   nicht unterstützt: {reason}");
        }
        for row in &report.settings {
            println!("   {}: {}{}", row.label, row.current, row.target.as_ref().map(|t| format!(" → Ziel {t}")).unwrap_or_default());
        }
    }
    println!("\n## Geräte");
    for device in super::devices::enumerate_input_devices() {
        println!("   {:?} · {} · {:?} · Treiber {:?} · {:?}", device.kind, device.name, device.connection, device.driver, device.hardware_id);
    }
    assert!(!path.exists(), "Lesen darf keine Sicherung anlegen");
}

#[test]
fn system_responsiveness_is_explained_like_microsoft_documents_it() {
    use super::engine::responsiveness_meaning;
    assert!(responsiveness_meaning(Some(1)).contains("als 20 %"));
    assert!(responsiveness_meaning(Some(100)).contains("komplett ab"));
    assert!(responsiveness_meaning(Some(25)).starts_with("20 %"));
    assert!(responsiveness_meaning(None).contains("20 %"));
}

#[test]
fn registry_types_from_tweak_scripts_survive_apply_and_restore() {
    // So sieht es nach einem Batch-Tweak aus: Mauswerte als DWORD statt REG_SZ.
    let reg = Arc::new(FakeRegistry::default());
    for (name, value) in [("MouseSpeed", 1), ("MouseThreshold1", 6), ("MouseThreshold2", 10)] {
        reg.set(Hive::CurrentUser, MOUSE_KEY, name, RegValue::dword(value));
    }
    let sys = FakeSystem::default();
    *sys.mirror.lock().unwrap() = Some(reg.clone());
    let path = temp_store("dword");
    let e = engine(&reg, &sys, false, &path);

    let row = e.report(TweakId::MouseAcceleration).settings.into_iter().find(|r| r.label.starts_with("MouseSpeed")).unwrap();
    assert!(row.note.unwrap().contains("REG_DWORD"), "Typ-Warnung wird angezeigt");

    e.apply(TweakId::MouseAcceleration).unwrap();
    assert_eq!(reg.get(Hive::CurrentUser, MOUSE_KEY, "MouseSpeed"), Some(RegValue::sz("0")), "so wie Windows es speichert");

    e.restore(TweakId::MouseAcceleration, false).unwrap();
    assert_eq!(*sys.mouse.lock().unwrap(), [6, 10, 1]);
    for (name, value) in [("MouseSpeed", 1), ("MouseThreshold1", 6), ("MouseThreshold2", 10)] {
        assert_eq!(reg.get(Hive::CurrentUser, MOUSE_KEY, name), Some(RegValue::dword(value)), "{name}: Originaltyp DWORD zurück");
    }
}
