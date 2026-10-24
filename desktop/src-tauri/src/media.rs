//! Laufzeit aus MP4/MOV lesen, ohne die Datei zu laden: nur `moov/mvhd` wird gelesen.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

fn read_u32(file: &mut File) -> Option<u32> {
    let mut buf = [0; 4];
    file.read_exact(&mut buf).ok()?;
    Some(u32::from_be_bytes(buf))
}

fn read_u64(file: &mut File) -> Option<u64> {
    let mut buf = [0; 8];
    file.read_exact(&mut buf).ok()?;
    Some(u64::from_be_bytes(buf))
}

/// Sucht zwischen `start` und `end` die Box `wanted`; liefert (Inhaltsbeginn, Ende).
fn find_box(file: &mut File, start: u64, end: u64, wanted: &[u8; 4]) -> Option<(u64, u64)> {
    let mut offset = start;
    while offset + 8 <= end {
        file.seek(SeekFrom::Start(offset)).ok()?;
        let size32 = read_u32(file)?;
        let mut kind = [0; 4];
        file.read_exact(&mut kind).ok()?;
        let (header, size) = match size32 {
            0 => (8, end - offset),
            1 => (16, read_u64(file)?),
            n => (8, n as u64),
        };
        if size < header {
            return None;
        }
        if &kind == wanted {
            return Some((offset + header, offset + size));
        }
        offset += size;
    }
    None
}

pub fn duration_seconds(path: &Path) -> Option<f64> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let (moov_start, moov_end) = find_box(&mut file, 0, len, b"moov")?;
    let (mvhd, _) = find_box(&mut file, moov_start, moov_end, b"mvhd")?;
    file.seek(SeekFrom::Start(mvhd)).ok()?;
    let version = read_u32(&mut file)? >> 24;
    let (timescale, duration) = if version == 1 {
        file.seek(SeekFrom::Current(16)).ok()?;
        (read_u32(&mut file)?, read_u64(&mut file)?)
    } else {
        file.seek(SeekFrom::Current(8)).ok()?;
        (read_u32(&mut file)?, read_u32(&mut file)? as u64)
    };
    (timescale > 0).then(|| duration as f64 / timescale as f64)
}

pub fn mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        _ => "video/mp4",
    }
}
