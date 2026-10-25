//! Bildschirmausschnitte über die DXGI Desktop Duplication (dieselbe Technik wie
//! OBS' „Bildschirmaufnahme“). Das Spiel wird nicht angefasst: Windows reicht uns
//! nur das fertige Bild des Monitors. Kopiert werden ausschließlich die kleinen
//! Bereiche, die wir auswerten. Staging-Texturen werden zwischen Scans wiederverwendet.

use serde::{Deserialize, Serialize};
use windows::{
    core::Interface,
    Win32::{
        Foundation::HMODULE,
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
            Direct3D11::{
                D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
                D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
            },
            Dxgi::{
                Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC},
                CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
                DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
            },
        },
    },
};

/// Rechteck in Pixeln des Monitors.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Ein Bildausschnitt als BGRA-Pixel.
#[derive(Clone)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

impl Image {
    pub fn gray(&self) -> Vec<u8> {
        self.bgra
            .chunks_exact(4)
            .map(|p| ((p[2] as u32 * 77 + p[1] as u32 * 150 + p[0] as u32 * 29) >> 8) as u8)
            .collect()
    }

    /// Ausschnitt aus diesem Bild (z. B. die Hitmarker-Vorlage aus dem Screenshot).
    pub fn crop(&self, region: Region) -> Option<Image> {
        if region.width == 0 || region.height == 0 || region.x + region.width > self.width || region.y + region.height > self.height {
            return None;
        }
        let mut bgra = Vec::with_capacity((region.width * region.height * 4) as usize);
        for row in region.y..region.y + region.height {
            let start = ((row * self.width + region.x) * 4) as usize;
            bgra.extend_from_slice(&self.bgra[start..start + (region.width * 4) as usize]);
        }
        Some(Image { width: region.width, height: region.height, bgra })
    }

    /// Als 32-Bit-BMP speichern (für die Einrichtung im Fenster).
    pub fn save_bmp(&self, path: &std::path::Path) -> std::io::Result<()> {
        let size = self.bgra.len() as u32;
        let mut out = Vec::with_capacity(size as usize + 54);
        out.extend_from_slice(b"BM");
        out.extend_from_slice(&(54 + size).to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&54u32.to_le_bytes());
        out.extend_from_slice(&40u32.to_le_bytes());
        out.extend_from_slice(&(self.width as i32).to_le_bytes());
        // Negative Höhe = Zeilen von oben nach unten.
        out.extend_from_slice(&(-(self.height as i32)).to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&[0; 16]);
        out.extend_from_slice(&self.bgra);
        std::fs::write(path, out)
    }

    pub fn load_bmp(path: &std::path::Path) -> Option<Image> {
        let raw = std::fs::read(path).ok()?;
        if raw.len() < 54 || &raw[..2] != b"BM" {
            return None;
        }
        let offset = u32::from_le_bytes(raw[10..14].try_into().ok()?) as usize;
        let width = i32::from_le_bytes(raw[18..22].try_into().ok()?).unsigned_abs();
        let signed_height = i32::from_le_bytes(raw[22..26].try_into().ok()?);
        let height = signed_height.unsigned_abs();
        let bytes_per_pixel = (u16::from_le_bytes(raw[28..30].try_into().ok()?) / 8) as usize;
        if !(bytes_per_pixel == 3 || bytes_per_pixel == 4) {
            return None;
        }
        // Zeilen sind auf 4 Byte aufgefüllt; positive Höhe = von unten nach oben gespeichert.
        let stride = (width as usize * bytes_per_pixel + 3) & !3;
        let mut bgra = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height as usize {
            let row = if signed_height > 0 { height as usize - 1 - y } else { y };
            let line = raw.get(offset + row * stride..offset + row * stride + width as usize * bytes_per_pixel)?;
            for pixel in line.chunks_exact(bytes_per_pixel) {
                bgra.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
        }
        Some(Image { width, height, bgra })
    }
}

fn hr(error: windows::core::Error, what: &str) -> String {
    format!("{what}: {}", error.message())
}

/// Hält die Duplizierung des Hauptmonitors offen.
pub struct Screen {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    frame_owned: bool,
    staging: Vec<ID3D11Texture2D>,
    staging_sizes: Vec<(u32, u32)>,
    pub width: u32,
    pub height: u32,
}

impl Drop for Screen {
    fn drop(&mut self) {
        if self.frame_owned {
            unsafe {
                let _ = self.duplication.ReleaseFrame();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Direct3D11::{D3D11_SUBRESOURCE_DATA, D3D11_USAGE_DEFAULT};

    /// Hardware-Test mit synthetischen Pixeln, ohne Bildschirmbilder zu lesen.
    #[test]
    #[ignore]
    fn reuses_staging_and_recreates_it_for_resized_crops() {
        let mut screen = Screen::open().unwrap();
        let pixels: Vec<u8> = (0..64 * 32).flat_map(|i| [(i % 256) as u8, 42, 123, 255]).collect();
        let desc = D3D11_TEXTURE2D_DESC {
            Width: 64, Height: 32, MipLevels: 1, ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            ..Default::default()
        };
        let data = D3D11_SUBRESOURCE_DATA { pSysMem: pixels.as_ptr().cast(), SysMemPitch: 64 * 4, SysMemSlicePitch: 0 };
        let mut texture = None;
        unsafe {
            screen.device.CreateTexture2D(&desc, Some(&data), Some(&mut texture)).unwrap();
            let texture = texture.unwrap();
            let region = Region { x: 0, y: 0, width: 64, height: 32 };
            let first = screen.copy_region(&texture, region, 0).unwrap();
            assert_eq!(first.bgra, pixels);
            let staging = screen.staging[0].clone();
            for _ in 0..20 {
                assert_eq!(screen.copy_region(&texture, region, 0).unwrap().bgra, pixels);
                assert_eq!(screen.staging[0].as_raw(), staging.as_raw());
            }
            let crop = Region { x: 2, y: 3, width: 16, height: 8 };
            let cropped = screen.copy_region(&texture, crop, 0).unwrap();
            assert_eq!(cropped.bgra, first.crop(crop).unwrap().bgra);
            assert_ne!(screen.staging[0].as_raw(), staging.as_raw());
            assert!(screen.copy_region(&texture, Region { x: screen.width, ..crop }, 0).is_err());
        }
    }
}

// Die COM-Objekte benutzt immer nur, wer gerade die Sperre von `SHARED` hält.
unsafe impl Send for Screen {}

/// Windows lässt pro Prozess nur eine Duplizierung desselben Monitors zu – eine
/// zweite (Einrichtungs-Screenshot, während die Erkennung läuft) scheitert mit
/// „Falscher Parameter“. Darum teilen sich alle diese eine.
static SHARED: std::sync::Mutex<Option<Screen>> = std::sync::Mutex::new(None);

/// Arbeitet mit der gemeinsamen Duplizierung und öffnet sie bei Bedarf. Nach einem
/// Fehler wird sie geschlossen, damit der nächste Aufruf frisch verbindet.
pub fn with_screen<T>(f: impl FnOnce(&mut Screen) -> Result<T, String>) -> Result<T, String> {
    let mut slot = SHARED.lock().unwrap_or_else(|e| e.into_inner());
    if slot.is_none() {
        *slot = Some(Screen::open()?);
    }
    let result = f(slot.as_mut().unwrap());
    if result.is_err() {
        *slot = None;
    }
    result
}

/// Gibt den Monitor frei (Erkennung beendet). Die nächste Nutzung öffnet neu.
pub fn release() {
    *SHARED.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

unsafe fn create_device(adapter: &IDXGIAdapter1) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let mut device = None;
    let mut context = None;
    D3D11CreateDevice(
        adapter,
        D3D_DRIVER_TYPE_UNKNOWN,
        HMODULE::default(),
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        None,
        D3D11_SDK_VERSION,
        Some(&mut device),
        None,
        Some(&mut context),
    )
    .map_err(|e| hr(e, "Direct3D"))?;
    Ok((device.ok_or("Direct3D nicht verfügbar")?, context.ok_or("Direct3D nicht verfügbar")?))
}

impl Screen {
    /// Öffnet den Hauptmonitor (der mit dem Ursprung 0,0) – dort läuft das Spiel.
    ///
    /// Mit zwei Grafikchips (z. B. AMD im Prozessor + NVIDIA) muss das Gerät zum Chip
    /// passen, der den Monitor ansteuert – sonst meldet Windows „Falscher Parameter“.
    /// Deshalb erst der Chip des Monitors, dann zur Sicherheit alle anderen.
    pub fn open() -> Result<Self, String> {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(|e| hr(e, "DXGI"))?;
            let adapters: Vec<IDXGIAdapter1> = (0..).map_while(|i| factory.EnumAdapters1(i).ok()).collect();
            let mut primary = None;
            for (index, adapter) in adapters.iter().enumerate() {
                for output in (0..).map_while(|i| adapter.EnumOutputs(i).ok()) {
                    let desc = output.GetDesc().map_err(|e| hr(e, "Monitor"))?;
                    let r = desc.DesktopCoordinates;
                    if desc.AttachedToDesktop.as_bool() && r.left == 0 && r.top == 0 {
                        primary = Some((index, output, (r.right - r.left) as u32, (r.bottom - r.top) as u32));
                    }
                }
            }
            let (owner, output, width, height) = primary.ok_or("Kein Hauptmonitor gefunden")?;
            let output: IDXGIOutput1 = output.cast().map_err(|e| hr(e, "Monitor"))?;
            let order = std::iter::once(owner).chain((0..adapters.len()).filter(|i| *i != owner));
            let mut last_error = String::from("Bildschirmzugriff nicht möglich");
            for index in order {
                let (device, context) = match create_device(&adapters[index]) {
                    Ok(pair) => pair,
                    Err(error) => {
                        last_error = error;
                        continue;
                    }
                };
                match output.DuplicateOutput(&device) {
                    Ok(duplication) => return Ok(Self {
                        device, context, duplication, width, height,
                        frame_owned: false, staging: Vec::new(), staging_sizes: Vec::new(),
                    }),
                    Err(error) => last_error = hr(error, "Bildschirmzugriff"),
                }
            }
            Err(last_error)
        }
    }

    /// Wartet bis zu `timeout_ms` auf ein neues Bild und kopiert die gewünschten
    /// Bereiche heraus. `None` = seitdem hat sich nichts geändert.
    pub fn grab(&mut self, regions: &[Region], timeout_ms: u32) -> Result<Option<Vec<Image>>, String> {
        self.grab_inner(regions, timeout_ms, false)
    }

    fn grab_inner(&mut self, regions: &[Region], timeout_ms: u32, any_frame: bool) -> Result<Option<Vec<Image>>, String> {
        unsafe {
            // DXGI empfiehlt Release unmittelbar vor Acquire: Solange wir das
            // Bild besitzen, muss Windows nicht jedes Spielframe hineinkopieren.
            // https://learn.microsoft.com/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutputduplication-releaseframe
            if self.frame_owned {
                self.frame_owned = false;
                self.duplication.ReleaseFrame().map_err(|e| hr(e, "Bild freigeben"))?;
            }
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource: Option<IDXGIResource> = None;
            match self.duplication.AcquireNextFrame(timeout_ms, &mut info, &mut resource) {
                Ok(()) => {}
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
                // Auflösungswechsel, Vollbild-Umschaltung, UAC: Der Fehler lässt `with_screen`
                // die alte Duplizierung schließen – erst danach geht eine neue.
                Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => return Err("Bildschirmzugriff verloren".into()),
                Err(e) => return Err(hr(e, "Bild holen")),
            }
            self.frame_owned = true;
            (|| {
                // Nur der Mauszeiger hat sich bewegt – das Bild ist dasselbe.
                if info.LastPresentTime == 0 && !any_frame {
                    return Ok(None);
                }
                let texture: ID3D11Texture2D = resource.ok_or("Kein Bild")?.cast().map_err(|e| hr(e, "Bild"))?;
                let mut images = Vec::with_capacity(regions.len());
                self.staging.truncate(regions.len());
                self.staging_sizes.truncate(regions.len());
                for (index, region) in regions.iter().enumerate() {
                    images.push(self.copy_region(&texture, *region, index)?);
                }
                Ok(Some(images))
            })()
        }
    }

    unsafe fn copy_region(&mut self, texture: &ID3D11Texture2D, region: Region, index: usize) -> Result<Image, String> {
        let width = region.width.min(self.width.saturating_sub(region.x));
        let height = region.height.min(self.height.saturating_sub(region.y));
        if width == 0 || height == 0 {
            return Err("Erkennungsbereich liegt außerhalb des Monitors".into());
        }
        if self.staging_sizes.get(index) != Some(&(width, height)) {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut staging = None;
            self.device.CreateTexture2D(&desc, None, Some(&mut staging)).map_err(|e| hr(e, "Zwischenspeicher"))?;
            let staging = staging.ok_or("Zwischenspeicher")?;
            if index < self.staging.len() {
                self.staging[index] = staging;
                self.staging_sizes[index] = (width, height);
            } else {
                self.staging.push(staging);
                self.staging_sizes.push((width, height));
            }
        }
        let staging = &self.staging[index];
        let source_box = D3D11_BOX { left: region.x, top: region.y, front: 0, right: region.x + width, bottom: region.y + height, back: 1 };
        self.context.CopySubresourceRegion(staging, 0, 0, 0, 0, texture, 0, Some(&source_box));
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).map_err(|e| hr(e, "Bild lesen"))?;
        let mut bgra = Vec::with_capacity((width * height * 4) as usize);
        for row in 0..height as usize {
            let line = std::slice::from_raw_parts((mapped.pData as *const u8).add(row * mapped.RowPitch as usize), (width * 4) as usize);
            bgra.extend_from_slice(line);
        }
        self.context.Unmap(staging, 0);
        Ok(Image { width, height, bgra })
    }

    /// Ganzer Monitor – für den Einrichtungs-Screenshot.
    #[cfg(test)]
    pub fn screenshot(&mut self) -> Result<Image, String> {
        let full = Region { x: 0, y: 0, width: self.width, height: self.height };
        // Das erste Bild nach dem Öffnen kann leer sein; ein paar Versuche abwarten.
        for _ in 0..20 {
            if let Some(mut images) = self.grab_inner(&[full], 200, true)? {
                return Ok(images.remove(0));
            }
        }
        Err("Kein Bild vom Monitor erhalten".into())
    }
}
