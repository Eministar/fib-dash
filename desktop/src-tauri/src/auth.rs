//! Anmeldung über den Browser (Loopback + PKCE) und Ablage des Tokens in der
//! Windows-Anmeldeinformationsverwaltung. Das Fenster bekommt den Token nie zu sehen.

use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

// Dev-Builds (tauri dev) sprechen meist mit einem lokalen Dashboard und dürfen den
// Login der installierten App nicht überschreiben.
#[cfg(not(debug_assertions))]
const CREDENTIAL_TARGET: &str = "FIB Desktop/dashboard-token";
#[cfg(debug_assertions)]
const CREDENTIAL_TARGET: &str = "FIB Desktop/dashboard-token-dev";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn load_token() -> Option<String> {
    let target = wide(CREDENTIAL_TARGET);
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
            return None;
        }
        let blob = std::slice::from_raw_parts((*credential).CredentialBlob, (*credential).CredentialBlobSize as usize);
        let token = String::from_utf8(blob.to_vec()).ok();
        CredFree(credential.cast());
        token
    }
}

pub fn store_token(token: &str) -> Result<(), String> {
    let mut target = wide(CREDENTIAL_TARGET);
    let mut blob = token.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..unsafe { std::mem::zeroed() }
    };
    if unsafe { CredWriteW(&credential, 0) } == 0 {
        return Err("Token konnte nicht sicher gespeichert werden".into());
    }
    Ok(())
}

pub fn delete_token() {
    let target = wide(CREDENTIAL_TARGET);
    unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
}

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("Zufallsquelle nicht verfügbar");
    URL_SAFE_NO_PAD.encode(buf)
}

pub struct LoginRequest {
    pub listener: TcpListener,
    pub url: String,
    pub state: String,
    pub verifier: String,
}

/// Bereitet die Anmeldung vor: lokaler Port, PKCE-Paar und die Browser-Adresse.
pub fn prepare_login(base_url: &str) -> Result<LoginRequest, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let verifier = random_b64(32);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_b64(16);
    let url = format!("{base_url}/desktop-connect?port={port}&state={state}&challenge={challenge}");
    Ok(LoginRequest { listener, url, state, verifier })
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| percent_decode(v))
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b'+' => out.push(b' '),
            other => out.push(other),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>FIB Desktop</title>\
<body style=\"font-family:Segoe UI,system-ui;background:#000;color:#f5f5f7;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h1 style=\"font-size:20px;font-weight:600\">Angemeldet</h1>\
<p style=\"color:#98989d;font-size:14px\">Du kannst dieses Fenster schließen und zur FIB-Desktop-App zurückkehren.</p></div>";

/// Wartet, bis der Browser mit dem Code zurückkommt. Bricht ab, wenn eine neuere
/// Anmeldung gestartet wurde (`generation` hat sich geändert) oder die Zeit abläuft.
pub fn wait_for_code(request: &LoginRequest, generation: &AtomicU64, my_generation: u64) -> Result<String, String> {
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    while Instant::now() < deadline {
        if generation.load(Ordering::SeqCst) != my_generation {
            return Err("Anmeldung abgebrochen".into());
        }
        let Ok((mut stream, _)) = request.listener.accept() else {
            std::thread::sleep(Duration::from_millis(150));
            continue;
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]);
        let target = head.lines().next().and_then(|line| line.split_whitespace().nth(1)).unwrap_or("");
        let Some(query) = target.strip_prefix("/callback?") else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        };
        let code = query_param(query, "code");
        let state = query_param(query, "state");
        let body = DONE_PAGE.as_bytes();
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .as_bytes(),
        );
        let _ = stream.write_all(body);
        if state.as_deref() != Some(request.state.as_str()) {
            return Err("Anmeldung konnte nicht bestätigt werden (State passt nicht)".into());
        }
        return code.filter(|c| !c.is_empty()).ok_or_else(|| "Kein Anmeldecode erhalten".into());
    }
    Err("Anmeldung abgelaufen – bitte erneut versuchen".into())
}
