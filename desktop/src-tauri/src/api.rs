//! Aufrufe ans Dashboard. Clips gehen über dieselbe Chunk-Upload-API wie im Browser.

use std::{
    collections::VecDeque,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, UNIX_EPOCH},
};

use reqwest::{Client, Method, RequestBuilder, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::{auth, media};

/// Wird beim Build über FIB_DASHBOARD_URL gesetzt (siehe .github/workflows/desktop.yml).
pub fn base_url() -> &'static str {
    option_env!("FIB_DASHBOARD_URL").unwrap_or("http://localhost:3000").trim_end_matches('/')
}

pub const UNAUTHORIZED: &str = "UNAUTHORIZED";
const UPLOAD_WORKERS: usize = 3;
const CHUNK_ATTEMPTS: u32 = 3;

#[derive(Deserialize)]
struct Envelope<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

pub fn client() -> Client {
    Client::builder()
        .user_agent(concat!("FIB-Desktop/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .expect("HTTP-Client konnte nicht erstellt werden")
}

fn request(client: &Client, method: Method, path: &str) -> Result<RequestBuilder, String> {
    let token = auth::load_token().ok_or(UNAUTHORIZED)?;
    Ok(client.request(method, format!("{}{path}", base_url())).bearer_auth(token))
}

async fn send<T: DeserializeOwned>(builder: RequestBuilder) -> Result<T, String> {
    let response = builder.send().await.map_err(|e| format!("Dashboard nicht erreichbar: {e}"))?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(UNAUTHORIZED.into());
    }
    let envelope: Envelope<T> = response
        .json()
        .await
        .map_err(|_| format!("Unerwartete Antwort vom Dashboard (HTTP {status})"))?;
    if !envelope.success {
        return Err(envelope.error.unwrap_or_else(|| format!("Fehler (HTTP {status})")));
    }
    envelope.data.ok_or_else(|| "Leere Antwort vom Dashboard".into())
}

pub async fn exchange_code(client: &Client, code: &str, verifier: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct TokenResponse {
        token: String,
    }
    let device = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows-PC".into());
    let builder = client
        .post(format!("{}/api/desktop/token", base_url()))
        .json(&json!({ "code": code, "verifier": verifier, "deviceName": device }));
    Ok(send::<TokenResponse>(builder).await?.token)
}

pub async fn session(client: &Client) -> Result<Value, String> {
    send(request(client, Method::GET, "/api/desktop/session")?).await
}

pub async fn revoke(client: &Client) {
    if let Ok(builder) = request(client, Method::DELETE, "/api/desktop/session") {
        let _ = builder.send().await;
    }
}

// ── Upload ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadSession {
    session_id: String,
    chunk_size: u64,
    chunk_count: u64,
    received: Vec<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    pub sent_bytes: u64,
    pub total_bytes: u64,
    pub phase: &'static str,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Wie im Browser: Abdruck aus Name, Größe und Änderungszeit, damit ein
/// abgebrochener Upload beim nächsten Versuch fortgesetzt wird.
fn fingerprint(name: &str, size: u64, path: &Path) -> String {
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    hex(&Sha256::digest(format!("{name}:{size}:{modified}").as_bytes()))
}

async fn read_chunk(path: &Path, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let mut file = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
    file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|e| e.to_string())?;
    let mut buf = vec![0; len as usize];
    file.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Überträgt die Datei und liefert das Upload-Ticket, das `create_clip` einlöst.
pub async fn upload_file(
    client: &Client,
    path: &Path,
    cancel: Arc<AtomicBool>,
    on_progress: impl Fn(UploadProgress) + Send + Sync + 'static,
) -> Result<String, String> {
    let total = std::fs::metadata(path).map_err(|e| format!("Clip nicht lesbar: {e}"))?.len();
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("clip.mp4").to_string();

    let session: UploadSession = send(request(client, Method::POST, "/api/uploads")?.json(&json!({
        "kind": "CLIP",
        "originalName": name,
        "mimeType": media::mime_type(path),
        "totalBytes": total,
        "fingerprint": fingerprint(&name, total, path),
    })))
    .await?;

    let size_of = |index: u64| {
        if index == session.chunk_count - 1 { total - session.chunk_size * index } else { session.chunk_size }
    };
    let already: u64 = session.received.iter().map(|&i| size_of(i)).sum();
    let sent = Arc::new(AtomicU64::new(already));
    let on_progress = Arc::new(on_progress);
    on_progress(UploadProgress { sent_bytes: already, total_bytes: total, phase: "upload" });

    let queue: VecDeque<u64> = (0..session.chunk_count).filter(|i| !session.received.contains(i)).collect();
    let queue = Arc::new(Mutex::new(queue));
    let failure: Arc<Mutex<Option<String>>> = Arc::default();

    let mut workers = tokio::task::JoinSet::new();
    for _ in 0..UPLOAD_WORKERS {
        let (client, path, queue, sent, failure, cancel, on_progress) = (
            client.clone(),
            path.to_path_buf(),
            queue.clone(),
            sent.clone(),
            failure.clone(),
            cancel.clone(),
            on_progress.clone(),
        );
        let session_id = session.session_id.clone();
        let (chunk_size, chunk_count) = (session.chunk_size, session.chunk_count);
        workers.spawn(async move {
            loop {
                if cancel.load(Ordering::SeqCst) || failure.lock().unwrap().is_some() {
                    return;
                }
                let Some(index) = queue.lock().unwrap().pop_front() else { return };
                let len = if index == chunk_count - 1 { total - chunk_size * index } else { chunk_size };
                let result = async {
                    let data = read_chunk(&path, index * chunk_size, len).await?;
                    let digest = hex(&Sha256::digest(&data));
                    let mut last_error = String::new();
                    for attempt in 0..CHUNK_ATTEMPTS {
                        if attempt > 0 {
                            tokio::time::sleep(Duration::from_millis(500 << attempt)).await;
                        }
                        let builder = request(&client, Method::PUT, &format!("/api/uploads/{session_id}/chunks/{index}"))?
                            .header("Content-Type", "application/octet-stream")
                            .header("x-chunk-sha256", &digest)
                            .body(data.clone());
                        match send::<Value>(builder).await {
                            Ok(_) => return Ok(()),
                            Err(e) if e == UNAUTHORIZED => return Err(e),
                            Err(e) => last_error = e,
                        }
                    }
                    Err(format!("Teil {} von {chunk_count} ließ sich nicht übertragen: {last_error}", index + 1))
                }
                .await;
                match result {
                    Ok(()) => {
                        let now = sent.fetch_add(len, Ordering::SeqCst) + len;
                        on_progress(UploadProgress { sent_bytes: now, total_bytes: total, phase: "upload" });
                    }
                    Err(e) => {
                        failure.lock().unwrap().get_or_insert(e);
                        return;
                    }
                }
            }
        });
    }
    while workers.join_next().await.is_some() {}

    if cancel.load(Ordering::SeqCst) {
        // Die Sitzung bleibt stehen – ein späterer Versuch setzt dort fort.
        return Err("Upload abgebrochen".into());
    }
    if let Some(error) = failure.lock().unwrap().take() {
        return Err(error);
    }

    on_progress(UploadProgress { sent_bytes: total, total_bytes: total, phase: "finishing" });
    let path_complete = format!("/api/uploads/{}/complete", session.session_id);
    send::<Value>(request(client, Method::POST, &path_complete)?).await?;

    Ok(session.session_id)
}

/// Legt den Clip mit den Formulardaten in der Akte an.
pub async fn create_clip(client: &Client, upload_id: &str, mut meta: Value) -> Result<Value, String> {
    meta["uploadId"] = Value::String(upload_id.to_string());
    send(request(client, Method::POST, "/api/investigations/clips")?.json(&meta)).await
}
