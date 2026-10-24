//! Angeschlossene Tastaturen und Mäuse über die SetupAPI: Name, Hersteller,
//! Treiber, Hardware-ID und Verbindungsart. Nur lesend.

use serde::Serialize;
use windows::{
    core::PCWSTR,
    Win32::Devices::{
        DeviceAndDriverInstallation::{
            CM_Get_DevNode_PropertyW, CM_Get_Parent, CR_SUCCESS, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, SetupDiGetDevicePropertyW,
            SetupDiGetDeviceRegistryPropertyW, DIGCF_PRESENT, GUID_DEVCLASS_KEYBOARD, GUID_DEVCLASS_MOUSE, SETUP_DI_REGISTRY_PROPERTY,
            SPDRP_DEVICEDESC, SPDRP_ENUMERATOR_NAME, SPDRP_FRIENDLYNAME, SPDRP_HARDWAREID, SPDRP_MFG, SPDRP_SERVICE, SP_DEVINFO_DATA,
        },
        Properties::{DEVPKEY_Device_BusReportedDeviceDesc, DEVPROPTYPE},
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Keyboard,
    Mouse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Connection {
    /// USB – auch Funk-Empfänger (Dongle) melden sich so.
    Usb,
    Bluetooth,
    Ps2,
    Virtual,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    pub kind: DeviceKind,
    pub name: String,
    pub manufacturer: Option<String>,
    pub connection: Connection,
    pub hardware_id: Option<String>,
    pub vendor_id: Option<String>,
    pub product_id: Option<String>,
    /// Geladener Treiber, z. B. kbdhid, mouhid, i8042prt.
    pub driver: Option<String>,
    pub note: Option<String>,
}

/// Verbindungsart aus Treiber und Hardware-IDs ableiten.
pub fn classify(service: Option<&str>, enumerator: Option<&str>, hardware_ids: &[String]) -> Connection {
    let ids = hardware_ids.join(" ").to_ascii_uppercase();
    let service = service.unwrap_or_default().to_ascii_lowercase();
    let enumerator = enumerator.unwrap_or_default().to_ascii_uppercase();
    if service == "i8042prt" || ids.contains("*PNP03") || ids.contains("*PNP0F") {
        return Connection::Ps2;
    }
    // HID über Bluetooth Classic (00001124) und Bluetooth LE (00001812, HID-over-GATT).
    if ids.contains("BTHENUM") || ids.contains("BTHLEDEVICE") || ids.contains("00001124-0000-1000-8000-00805F9B34FB") || ids.contains("00001812-0000-1000-8000-00805F9B34FB") {
        return Connection::Bluetooth;
    }
    if ids.contains("VID_") {
        return Connection::Usb;
    }
    if enumerator == "ROOT" || enumerator == "SWD" || ids.contains("ROOT\\") || ids.contains("SWD\\") {
        return Connection::Virtual;
    }
    Connection::Unknown
}

/// „HID\VID_046D&PID_C08B&MI_00“ → ("046D", "C08B").
pub fn vid_pid(hardware_ids: &[String]) -> (Option<String>, Option<String>) {
    let find = |prefix: &str| {
        hardware_ids.iter().find_map(|id| {
            let upper = id.to_ascii_uppercase();
            let start = upper.find(prefix)? + prefix.len();
            let value: String = upper[start..].chars().take_while(|c| c.is_ascii_hexdigit()).collect();
            (value.len() == 4).then_some(value)
        })
    };
    (find("VID_"), find("PID_"))
}

fn utf16(bytes: &[u8]) -> Vec<String> {
    let wide: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
    wide.split(|&c| c == 0).filter(|s| !s.is_empty()).map(String::from_utf16_lossy).collect()
}

unsafe fn registry_property(
    set: windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
    data: &SP_DEVINFO_DATA,
    property: SETUP_DI_REGISTRY_PROPERTY,
) -> Vec<String> {
    let mut buffer = vec![0u8; 2048];
    let mut needed = 0u32;
    if SetupDiGetDeviceRegistryPropertyW(set, data, property, None, Some(&mut buffer), Some(&mut needed)).is_err() {
        return Vec::new();
    }
    buffer.truncate(needed as usize);
    utf16(&buffer)
}

/// Produktname, wie ihn das Gerät selbst meldet (z. B. „G502 HERO Gaming Mouse“).
unsafe fn bus_reported_name(set: windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO, data: &SP_DEVINFO_DATA, walk_parents: bool) -> Option<String> {
    let mut buffer = vec![0u8; 512];
    let mut kind = DEVPROPTYPE::default();
    let mut needed = 0u32;
    if SetupDiGetDevicePropertyW(set, data, &DEVPKEY_Device_BusReportedDeviceDesc, &mut kind, Some(&mut buffer), Some(&mut needed), 0).is_ok() {
        buffer.truncate(needed as usize);
        if let Some(name) = utf16(&buffer).into_iter().next().filter(|n| !is_generic(n)) {
            return Some(name);
        }
    }
    // HID-Sammlungen tragen oft nur „HID-konforme Maus“ – den Produktnamen meldet das USB-Gerät darüber.
    // Nur für USB: über PS/2-Anschlüssen liegt bloß die Mainboard-Brücke.
    if !walk_parents {
        return None;
    }
    let mut node = data.DevInst;
    for _ in 0..3 {
        let mut parent = 0u32;
        if CM_Get_Parent(&mut parent, node, 0) != CR_SUCCESS {
            break;
        }
        node = parent;
        let mut size = buffer.len() as u32;
        let mut kind = DEVPROPTYPE::default();
        if CM_Get_DevNode_PropertyW(node, &DEVPKEY_Device_BusReportedDeviceDesc, &mut kind, Some(buffer.as_mut_ptr()), &mut size, 0) == CR_SUCCESS {
            if let Some(name) = utf16(&buffer[..size as usize]).into_iter().next().filter(|n| !is_generic(n)) {
                return Some(name);
            }
        }
    }
    None
}

/// Windows-Platzhalternamen, die nichts über das Gerät verraten.
fn is_generic(name: &str) -> bool {
    let lower = name.to_lowercase();
    ["hid-konform", "hid-compliant", "hid-tastatur", "hid keyboard", "usb-eingabegerät", "usb input device", "usb receiver", "usb-verbundgerät", "usb composite"]
        .iter()
        .any(|generic| lower.contains(generic))
}

fn enumerate_class(kind: DeviceKind) -> Vec<InputDevice> {
    let guid = match kind {
        DeviceKind::Keyboard => GUID_DEVCLASS_KEYBOARD,
        DeviceKind::Mouse => GUID_DEVCLASS_MOUSE,
    };
    let mut out = Vec::new();
    unsafe {
        let Ok(set) = SetupDiGetClassDevsW(Some(&guid), PCWSTR::null(), None, DIGCF_PRESENT) else {
            return out;
        };
        let mut index = 0;
        loop {
            let mut data = SP_DEVINFO_DATA { cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
            if SetupDiEnumDeviceInfo(set, index, &mut data).is_err() {
                break;
            }
            index += 1;
            let hardware_ids = registry_property(set, &data, SPDRP_HARDWAREID);
            let service = registry_property(set, &data, SPDRP_SERVICE).into_iter().next();
            let enumerator = registry_property(set, &data, SPDRP_ENUMERATOR_NAME).into_iter().next();
            let name = bus_reported_name(set, &data, vid_pid(&hardware_ids).0.is_some())
                .or_else(|| registry_property(set, &data, SPDRP_FRIENDLYNAME).into_iter().next())
                .or_else(|| registry_property(set, &data, SPDRP_DEVICEDESC).into_iter().next())
                .unwrap_or_else(|| "Unbekanntes Gerät".into());
            let manufacturer = registry_property(set, &data, SPDRP_MFG).into_iter().next().filter(|m| !m.starts_with('('));
            let (vendor_id, product_id) = vid_pid(&hardware_ids);
            let connection = classify(service.as_deref(), enumerator.as_deref(), &hardware_ids);
            out.push(InputDevice {
                kind,
                note: (connection == Connection::Ps2)
                    .then(|| "Viele Mainboards melden einen PS/2-Anschluss, auch wenn dort nichts steckt.".to_string()),
                connection,
                name,
                manufacturer,
                hardware_id: hardware_ids.first().cloned(),
                vendor_id,
                product_id,
                driver: service,
            });
        }
        let _ = SetupDiDestroyDeviceInfoList(set);
    }
    out
}

/// Mäuse und Tastaturen. Ein Gerät mit mehreren HID-Schnittstellen (z. B. Maus mit
/// Zusatztasten) erscheint nur einmal je Art.
pub fn enumerate_input_devices() -> Vec<InputDevice> {
    let mut devices = enumerate_class(DeviceKind::Mouse);
    devices.extend(enumerate_class(DeviceKind::Keyboard));
    dedupe(devices)
}

pub fn dedupe(devices: Vec<InputDevice>) -> Vec<InputDevice> {
    let mut seen = std::collections::HashSet::new();
    devices
        .into_iter()
        .filter(|d| match (&d.vendor_id, &d.product_id) {
            (Some(v), Some(p)) => seen.insert((d.kind, v.clone(), p.clone())),
            _ => true,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn classifies_connections() {
        assert_eq!(classify(Some("kbdhid"), Some("HID"), &ids(&["HID\\VID_046D&PID_C33F&REV_0100&MI_00", "HID_DEVICE_SYSTEM_KEYBOARD"])), Connection::Usb);
        assert_eq!(classify(Some("i8042prt"), Some("ACPI"), &ids(&["ACPI\\VEN_PNP&DEV_0303", "*PNP0303"])), Connection::Ps2);
        assert_eq!(
            classify(Some("mouhid"), Some("HID"), &ids(&["HID\\{00001812-0000-1000-8000-00805f9b34fb}_Dev_VID&02046d_PID&b023"])),
            Connection::Bluetooth
        );
        assert_eq!(classify(Some("kbdhid"), Some("SWD"), &ids(&["SWD\\VirtualKeyboard"])), Connection::Virtual);
        assert_eq!(classify(None, None, &[]), Connection::Unknown);
    }

    #[test]
    fn generic_names_are_recognized_and_composite_devices_listed_once() {
        assert!(is_generic("HID-konforme Maus"));
        assert!(!is_generic("G502 HERO Gaming Mouse"));
        let device = |kind, pid: &str| InputDevice {
            kind,
            name: "x".into(),
            manufacturer: None,
            connection: Connection::Usb,
            hardware_id: None,
            vendor_id: Some("10F5".into()),
            product_id: Some(pid.into()),
            driver: None,
            note: None,
        };
        let list = dedupe(vec![device(DeviceKind::Keyboard, "5009"), device(DeviceKind::Keyboard, "5009"), device(DeviceKind::Mouse, "5009")]);
        assert_eq!(list.len(), 2, "Tastatur einmal, Maus derselben Hardware extra");
    }

    #[test]
    fn extracts_vendor_and_product() {
        assert_eq!(vid_pid(&ids(&["HID\\VID_046D&PID_C08B&MI_00"])), (Some("046D".into()), Some("C08B".into())));
        assert_eq!(vid_pid(&ids(&["ACPI\\PNP0303"])), (None, None));
    }
}
