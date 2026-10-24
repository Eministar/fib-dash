//! Tauri-Befehle des WASD Tweaks. Alles läuft im Hintergrund-Thread, damit
//! Registry-Zugriffe und UAC-Abfragen das Fenster nicht einfrieren.
//! Das Fenster übergibt nur Tweak-IDs; alles andere wird hier geprüft.

use std::time::Duration;

use tauri::State;

use super::devices::{enumerate_input_devices, InputDevice};
use super::engine::{ApplyResult, PlannedChange, RestoreResult};
use super::model::{TweakError, TweakId, TweakResult};
use super::polling::{measure, PollingResult};
use super::{WasdDetails, WasdStatus};
use crate::AppState;

fn parse(id: &str) -> TweakResult<TweakId> {
    TweakId::parse(id).ok_or_else(|| TweakError::invalid(format!("Unbekannter Tweak „{id}“")))
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> TweakResult<T> + Send + 'static) -> TweakResult<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| TweakError::os(e.to_string()))?
}

#[tauri::command]
pub async fn get_wasd_tweak_status(state: State<'_, AppState>) -> TweakResult<WasdStatus> {
    let service = state.tweaks.clone();
    blocking(move || Ok(service.status())).await
}

#[tauri::command]
pub async fn get_wasd_tweak_details(state: State<'_, AppState>) -> TweakResult<WasdDetails> {
    let service = state.tweaks.clone();
    blocking(move || Ok(service.details())).await
}

#[tauri::command]
pub async fn preview_wasd_changes(state: State<'_, AppState>) -> TweakResult<Vec<PlannedChange>> {
    let service = state.tweaks.clone();
    blocking(move || service.preview()).await
}

#[tauri::command]
pub async fn apply_wasd_tweak(state: State<'_, AppState>) -> TweakResult<ApplyResult> {
    let service = state.tweaks.clone();
    blocking(move || service.apply_profile()).await
}

#[tauri::command]
pub async fn restore_wasd_tweak(state: State<'_, AppState>, force: Option<bool>) -> TweakResult<RestoreResult> {
    let service = state.tweaks.clone();
    blocking(move || service.restore_profile(force.unwrap_or(false))).await
}

#[tauri::command]
pub async fn apply_tweak(state: State<'_, AppState>, id: String, confirmed: Option<bool>) -> TweakResult<ApplyResult> {
    let id = parse(&id)?;
    let service = state.tweaks.clone();
    blocking(move || service.apply(id, confirmed.unwrap_or(false))).await
}

#[tauri::command]
pub async fn restore_tweak(state: State<'_, AppState>, id: String, force: Option<bool>) -> TweakResult<RestoreResult> {
    let id = parse(&id)?;
    let service = state.tweaks.clone();
    blocking(move || service.restore(id, force.unwrap_or(false))).await
}

#[tauri::command]
pub async fn restore_all_tweaks(state: State<'_, AppState>, force: Option<bool>) -> TweakResult<RestoreResult> {
    let service = state.tweaks.clone();
    blocking(move || service.restore_all(force.unwrap_or(false))).await
}

#[tauri::command]
pub async fn get_input_devices() -> TweakResult<Vec<InputDevice>> {
    blocking(|| Ok(enumerate_input_devices())).await
}

/// Misst `seconds` Sekunden (2–10); währenddessen die Maus bewegen.
#[tauri::command]
pub async fn measure_polling_rate(seconds: Option<u32>) -> TweakResult<Vec<PollingResult>> {
    let seconds = seconds.unwrap_or(3).clamp(2, 10);
    blocking(move || measure(Duration::from_secs(seconds as u64))).await
}
