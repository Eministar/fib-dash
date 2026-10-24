//! Echte Windows-Anbindung der Traits aus `platform.rs`.

use windows::Win32::UI::{
    Accessibility::FILTERKEYS,
    WindowsAndMessaging::{
        SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_GETFILTERKEYS, SPI_GETKEYBOARDDELAY, SPI_GETKEYBOARDSPEED,
        SPI_GETMOUSE, SPI_GETMOUSESPEED, SPI_SETFILTERKEYS, SPI_SETKEYBOARDDELAY, SPI_SETKEYBOARDSPEED, SPI_SETMOUSE,
        SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    },
};
use winreg::{
    enums::{RegType, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_SET_VALUE},
    RegKey,
};

use super::model::{ErrorCode, TweakError, TweakResult};
use super::platform::{FilterKeys, Hive, RegValue, Registry, SystemParams};

const ERROR_ACCESS_DENIED: i32 = 5;
const ERROR_FILE_NOT_FOUND: i32 = 2;

fn root(hive: Hive) -> RegKey {
    RegKey::predef(match hive {
        Hive::CurrentUser => HKEY_CURRENT_USER,
        Hive::LocalMachine => HKEY_LOCAL_MACHINE,
    })
}

fn io_error(error: std::io::Error, what: &str) -> TweakError {
    if error.raw_os_error() == Some(ERROR_ACCESS_DENIED) {
        return TweakError::new(ErrorCode::NeedsElevation, format!("{what}: Zugriff verweigert – Administratorrechte nötig."));
    }
    TweakError::os(format!("{what}: {error}"))
}

fn reg_type(kind: u32) -> RegType {
    match kind {
        1 => RegType::REG_SZ,
        2 => RegType::REG_EXPAND_SZ,
        3 => RegType::REG_BINARY,
        4 => RegType::REG_DWORD,
        5 => RegType::REG_DWORD_BIG_ENDIAN,
        6 => RegType::REG_LINK,
        7 => RegType::REG_MULTI_SZ,
        11 => RegType::REG_QWORD,
        _ => RegType::REG_NONE,
    }
}

pub struct WinRegistry;

impl Registry for WinRegistry {
    fn key_exists(&self, hive: Hive, path: &str) -> TweakResult<bool> {
        match root(hive).open_subkey_with_flags(path, KEY_QUERY_VALUE) {
            Ok(_) => Ok(true),
            Err(e) if e.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) => Ok(false),
            Err(e) => Err(io_error(e, path)),
        }
    }

    fn read(&self, hive: Hive, path: &str, name: &str) -> TweakResult<Option<RegValue>> {
        let key = match root(hive).open_subkey_with_flags(path, KEY_QUERY_VALUE) {
            Ok(key) => key,
            Err(e) if e.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) => return Ok(None),
            Err(e) => return Err(io_error(e, path)),
        };
        match key.get_raw_value(name) {
            Ok(value) => Ok(Some(RegValue { kind: value.vtype as u32, data: value.bytes.into_owned() })),
            Err(e) if e.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) => Ok(None),
            Err(e) => Err(io_error(e, name)),
        }
    }

    fn write(&self, hive: Hive, path: &str, name: &str, value: &RegValue) -> TweakResult<()> {
        // Nur bestehende Schlüssel – die App legt keine neuen Registry-Zweige an.
        let key = root(hive).open_subkey_with_flags(path, KEY_SET_VALUE).map_err(|e| io_error(e, path))?;
        let raw = winreg::RegValue { bytes: std::borrow::Cow::Borrowed(&value.data), vtype: reg_type(value.kind) };
        key.set_raw_value(name, &raw).map_err(|e| io_error(e, name))
    }

    fn delete(&self, hive: Hive, path: &str, name: &str) -> TweakResult<()> {
        let key = match root(hive).open_subkey_with_flags(path, KEY_SET_VALUE) {
            Ok(key) => key,
            Err(e) if e.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) => return Ok(()),
            Err(e) => return Err(io_error(e, path)),
        };
        match key.delete_value(name) {
            Ok(()) => Ok(()),
            Err(e) if e.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) => Ok(()),
            Err(e) => Err(io_error(e, name)),
        }
    }
}

/// Dauerhaft im Benutzerprofil speichern und alle Fenster benachrichtigen (WM_SETTINGCHANGE).
const PERSIST: SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS = SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(SPIF_UPDATEINIFILE.0 | SPIF_SENDCHANGE.0);

fn flags(persist: bool) -> SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS {
    if persist { PERSIST } else { SPIF_SENDCHANGE }
}

fn spi_error(what: &str, error: windows::core::Error) -> TweakError {
    TweakError::os(format!("{what}: {}", error.message()))
}

pub struct WinSystemParams;

impl SystemParams for WinSystemParams {
    fn mouse(&self) -> TweakResult<[i32; 3]> {
        let mut value = [0i32; 3];
        unsafe { SystemParametersInfoW(SPI_GETMOUSE, 0, Some(value.as_mut_ptr().cast()), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)) }
            .map_err(|e| spi_error("Mausparameter lesen", e))?;
        Ok(value)
    }

    fn set_mouse(&self, mut value: [i32; 3], persist: bool) -> TweakResult<()> {
        unsafe { SystemParametersInfoW(SPI_SETMOUSE, 0, Some(value.as_mut_ptr().cast()), flags(persist)) }.map_err(|e| spi_error("Mausparameter setzen", e))
    }

    fn mouse_speed(&self) -> TweakResult<u32> {
        let mut value = 0u32;
        unsafe { SystemParametersInfoW(SPI_GETMOUSESPEED, 0, Some((&mut value as *mut u32).cast()), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)) }
            .map_err(|e| spi_error("Zeigergeschwindigkeit lesen", e))?;
        Ok(value)
    }

    fn keyboard_speed(&self) -> TweakResult<u32> {
        let mut value = 0u32;
        unsafe { SystemParametersInfoW(SPI_GETKEYBOARDSPEED, 0, Some((&mut value as *mut u32).cast()), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)) }
            .map_err(|e| spi_error("Wiederholrate lesen", e))?;
        Ok(value)
    }

    fn set_keyboard_speed(&self, value: u32, persist: bool) -> TweakResult<()> {
        unsafe { SystemParametersInfoW(SPI_SETKEYBOARDSPEED, value, None, flags(persist)) }.map_err(|e| spi_error("Wiederholrate setzen", e))
    }

    fn keyboard_delay(&self) -> TweakResult<u32> {
        let mut value = 0u32;
        unsafe { SystemParametersInfoW(SPI_GETKEYBOARDDELAY, 0, Some((&mut value as *mut u32).cast()), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)) }
            .map_err(|e| spi_error("Wiederholverzögerung lesen", e))?;
        Ok(value)
    }

    fn set_keyboard_delay(&self, value: u32, persist: bool) -> TweakResult<()> {
        unsafe { SystemParametersInfoW(SPI_SETKEYBOARDDELAY, value, None, flags(persist)) }.map_err(|e| spi_error("Wiederholverzögerung setzen", e))
    }

    fn filter_keys(&self) -> TweakResult<FilterKeys> {
        let mut raw = FILTERKEYS { cbSize: std::mem::size_of::<FILTERKEYS>() as u32, ..Default::default() };
        unsafe {
            SystemParametersInfoW(SPI_GETFILTERKEYS, raw.cbSize, Some((&mut raw as *mut FILTERKEYS).cast()), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0))
        }
        .map_err(|e| spi_error("FilterKeys lesen", e))?;
        Ok(FilterKeys { flags: raw.dwFlags, wait_ms: raw.iWaitMSec, delay_ms: raw.iDelayMSec, repeat_ms: raw.iRepeatMSec, bounce_ms: raw.iBounceMSec })
    }

    fn set_filter_keys(&self, value: FilterKeys) -> TweakResult<()> {
        // Immer die ganze Struktur – Zeitwerte bleiben so gültig zusammen.
        let mut raw = FILTERKEYS {
            cbSize: std::mem::size_of::<FILTERKEYS>() as u32,
            dwFlags: value.flags,
            iWaitMSec: value.wait_ms,
            iDelayMSec: value.delay_ms,
            iRepeatMSec: value.repeat_ms,
            iBounceMSec: value.bounce_ms,
        };
        unsafe { SystemParametersInfoW(SPI_SETFILTERKEYS, raw.cbSize, Some((&mut raw as *mut FILTERKEYS).cast()), PERSIST) }
            .map_err(|e| spi_error("FilterKeys setzen", e))
    }
}

/// Läuft die App mit Administratorrechten (erhöhter Token)?
pub fn is_admin() -> bool {
    unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() }
}

/// Zeitpunkt des Systemstarts in ms seit 1970.
pub fn boot_ms() -> u64 {
    let uptime = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() };
    let now = chrono::Utc::now().timestamp_millis().max(0) as u64;
    now.saturating_sub(uptime)
}
