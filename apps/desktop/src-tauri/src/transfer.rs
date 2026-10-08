use crate::identity::IdentityManager;
use crate::models::{
    ChatMessage, PrepareUploadRequest, PrepareUploadResponse, TransferProgressPayload,
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

pub const TRANSFER_PORT: u16 = 53317;

#[derive(Debug, Clone)]
pub struct SessionMetadata {
    pub transfer_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub sha256_expected: String,
    pub token: String,
    pub expires_at: i64,
    pub sender_name: String,
}

#[derive(Clone)]
pub struct TransferService {
    identity: IdentityManager,
    sessions: Arc<RwLock<HashMap<String, SessionMetadata>>>,
    chat_history: Arc<RwLock<HashMap<String, Vec<ChatMessage>>>>,
    app_handle: Option<AppHandle>,
    downloads_dir: PathBuf,
}

impl TransferService {
    pub fn new(identity: IdentityManager) -> Self {
        let downloads = dirs::download_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("AuraDrop");

        let _ = fs::create_dir_all(&downloads);

        Self {
            identity,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            chat_history: Arc::new(RwLock::new(HashMap::new())),
            app_handle: None,
            downloads_dir: downloads,
        }
    }

    pub fn set_app_handle(&mut self, app_handle: AppHandle) {
        self.app_handle = Some(app_handle);
    }

    pub fn get_downloads_dir(&self) -> String {
        self.downloads_dir.to_string_lossy().to_string()
    }

    pub fn start_server(&self) {
        let service = self.clone();

        tauri::async_runtime::spawn(async move {
            crate::log_debug("[TransferServer] spawn task entered");
            let app = Router::new()
                .route("/api/auradrop/v1/ping", get(handle_ping))
                .route("/api/auradrop/v1/info", get(handle_info))
                .route("/api/auradrop/v1/prepare-upload", post(handle_prepare_upload))
                .route(
                    "/api/auradrop/v1/upload",
                    post(handle_upload).layer(DefaultBodyLimit::max(50 * 1024 * 1024 * 1024)), // 50GB max
                )
                .route("/api/auradrop/v1/chat", post(handle_chat))
                .layer(CorsLayer::permissive())
                .with_state(service);

            crate::log_debug(&format!("[TransferServer] Attempting to bind TCP 0.0.0.0:{}", TRANSFER_PORT));
            let listener = match tokio::net::TcpListener::bind(format!("0.0.0.0:{}", TRANSFER_PORT)).await {
                Ok(l) => {
                    crate::log_debug(&format!("[TransferServer] Successfully bound TCP on 0.0.0.0:{}", TRANSFER_PORT));
                    l
                }
                Err(e) => {
                    crate::log_debug(&format!("[TransferServer] Port {} bind failed: {}", TRANSFER_PORT, e));
                    return;
                }
            };

            crate::log_debug(&format!("[TransferServer] Starting axum::serve on {}", TRANSFER_PORT));
            if let Err(e) = axum::serve(listener, app).await {
                crate::log_debug(&format!("[TransferServer] axum::serve error: {}", e));
            }
        });
    }

    pub async fn send_file(
        &self,
        peer_ip: String,
        peer_port: u16,
        file_path_str: String,
        peer_name: String,
    ) -> Result<(), String> {
        let path = PathBuf::from(&file_path_str);
        if !path.exists() {
            return Err("Selected file does not exist".to_string());
        }

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        let file_size = metadata.len();
        let transfer_id = format!("xfer_{}", Uuid::new_v4());

        // Emit initial status
        self.emit_progress(TransferProgressPayload {
            transfer_id: transfer_id.clone(),
            file_name: file_name.clone(),
            file_size,
            bytes_transferred: 0,
            progress_percent: 0.0,
            speed_mbps: 0.0,
            eta_seconds: 0,
            is_incoming: false,
            status: "transferring".to_string(),
            peer_name: peer_name.clone(),
            error: None,
            file_path: Some(file_path_str.clone()),
        })
        .await;

        // Step 1: Compute SHA-256
        let sha256_hash = {
            let mut file = File::open(&path).map_err(|e| e.to_string())?;
            let mut hasher = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
            }
            hex::encode(hasher.finalize())
        };

        // Step 2: Prepare upload
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(3600))
            .build()
            .map_err(|e| e.to_string())?;

        let prepare_url = format!("http://{}:{}/api/auradrop/v1/prepare-upload", peer_ip, peer_port);
        let my_name = self.identity.get_device_name().await;

        let prep_req = PrepareUploadRequest {
            transfer_id: transfer_id.clone(),
            file_id: transfer_id.clone(),
            file_name: file_name.clone(),
            file_size,
            sha256: sha256_hash.clone(),
            sender_user_id: my_name.clone(),
            sender_name: Some(my_name),
            receiver_user_id: None,
        };

        let prep_res = client
            .post(&prepare_url)
            .json(&prep_req)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to peer at {}: {}", prepare_url, e))?;

        if !prep_res.status().is_success() {
            let err = format!("Peer rejected prepare upload: HTTP {}", prep_res.status());
            self.emit_error(&transfer_id, &file_name, file_size, &peer_name, false, &err).await;
            return Err(err);
        }

        let prep_data: PrepareUploadResponse = prep_res
            .json()
            .await
            .map_err(|e| format!("Invalid prepare response: {}", e))?;

        // Step 3: Stream file bytes with progress tracking
        let upload_url = format!(
            "http://{}:{}/api/auradrop/v1/upload?transferId={}&token={}",
            peer_ip, peer_port, transfer_id, prep_data.one_time_token
        );

        let file_async = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
        let self_clone = self.clone();
        let transfer_id_clone = transfer_id.clone();
        let file_name_clone = file_name.clone();
        let peer_name_clone = peer_name.clone();
        let file_path_clone = file_path_str.clone();

        let mut transferred = 0u64;
        let start_time = Instant::now();
        let mut last_emit = Instant::now();

        let reader_stream = tokio_util::io::ReaderStream::new(file_async).map(move |item| {
            if let Ok(ref bytes) = item {
                transferred += bytes.len() as u64;
                if last_emit.elapsed().as_millis() >= 200 || transferred == file_size {
                    last_emit = Instant::now();
                    let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
                    let speed = (transferred as f64 / (1024.0 * 1024.0)) / elapsed;
                    let remaining = file_size.saturating_sub(transferred);
                    let eta = if speed > 0.0 {
                        ((remaining as f64 / (1024.0 * 1024.0)) / speed).ceil() as u64
                    } else {
                        0
                    };
                    let percent = if file_size > 0 {
                        (transferred as f64 / file_size as f64) * 100.0
                    } else {
                        100.0
                    };

                    let s = self_clone.clone();
                    let tid = transfer_id_clone.clone();
                    let fnm = file_name_clone.clone();
                    let pnm = peer_name_clone.clone();
                    let fp = file_path_clone.clone();

                    tauri::async_runtime::spawn(async move {
                        s.emit_progress(TransferProgressPayload {
                            transfer_id: tid,
                            file_name: fnm,
                            file_size,
                            bytes_transferred: transferred,
                            progress_percent: percent,
                            speed_mbps: speed,
                            eta_seconds: eta,
                            is_incoming: false,
                            status: if transferred >= file_size {
                                "completed".to_string()
                            } else {
                                "transferring".to_string()
                            },
                            peer_name: pnm,
                            error: None,
                            file_path: Some(fp),
                        })
                        .await;
                    });
                }
            }
            item
        });

        let body = Body::from_stream(reader_stream);

        let res = client
            .post(&upload_url)
            .header("x-transfer-id", &transfer_id)
            .header("x-file-name", &file_name)
            .header("x-file-size", file_size.to_string())
            .header("x-sha256", &sha256_hash)
            .header("x-expected-sha256", &sha256_hash)
            .header("x-token", &prep_data.one_time_token)
            .header("x-one-time-token", &prep_data.one_time_token)
            .header("x-session-token", &prep_data.one_time_token)
            .body(reqwest::Body::wrap_stream(body.into_data_stream()))
            .send()
            .await
            .map_err(|e| format!("Upload stream error: {}", e))?;

        if !res.status().is_success() {
            let err = format!("Upload failed: HTTP {}", res.status());
            self.emit_error(&transfer_id, &file_name, file_size, &peer_name, false, &err).await;
            return Err(err);
        }

        // Final Completed emit
        self.emit_progress(TransferProgressPayload {
            transfer_id: transfer_id.clone(),
            file_name: file_name.clone(),
            file_size,
            bytes_transferred: file_size,
            progress_percent: 100.0,
            speed_mbps: 0.0,
            eta_seconds: 0,
            is_incoming: false,
            status: "completed".to_string(),
            peer_name,
            error: None,
            file_path: Some(file_path_str),
        })
        .await;

        Ok(())
    }

    async fn emit_progress(&self, payload: TransferProgressPayload) {
        if let Some(ref handle) = self.app_handle {
            let _ = handle.emit("transfer-progress", payload);
        }
    }

    async fn emit_error(
        &self,
        transfer_id: &str,
        file_name: &str,
        file_size: u64,
        peer_name: &str,
        is_incoming: bool,
        error: &str,
    ) {
        if let Some(ref handle) = self.app_handle {
            let payload = TransferProgressPayload {
                transfer_id: transfer_id.to_string(),
                file_name: file_name.to_string(),
                file_size,
                bytes_transferred: 0,
                progress_percent: 0.0,
                speed_mbps: 0.0,
                eta_seconds: 0,
                is_incoming,
                status: "failed".to_string(),
                peer_name: peer_name.to_string(),
                error: Some(error.to_string()),
                file_path: None,
            };
            let _ = handle.emit("transfer-progress", payload);
        }
    }

    pub async fn send_chat(
        &self,
        peer_ip: String,
        peer_port: u16,
        peer_id: String,
        peer_name: String,
        text: String,
    ) -> Result<ChatMessage, String> {
        let my_id = self.identity.get_device_id().await;
        let my_name = self.identity.get_device_name().await;
        let now = Utc::now().timestamp_millis();
        let msg_id = format!("msg_{}", Uuid::new_v4().simple());

        let msg = ChatMessage {
            id: msg_id.clone(),
            peer_id: peer_id.clone(),
            peer_name: peer_name.clone(),
            sender_id: my_id.clone(),
            sender_name: my_name.clone(),
            text: text.clone(),
            timestamp: now,
            is_outgoing: true,
        };

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?;

        let url = format!("http://{}:{}/api/auradrop/v1/chat", peer_ip, peer_port);
        let res = client
            .post(&url)
            .json(&json!({
                "id": msg_id,
                "senderId": my_id,
                "senderName": my_name,
                "text": text,
                "timestamp": now,
            }))
            .send()
            .await
            .map_err(|e| format!("Failed to send chat to {}: {}", url, e))?;

        if !res.status().is_success() {
            return Err(format!("Peer returned error status: {}", res.status()));
        }

        {
            let mut hist = self.chat_history.write().await;
            hist.entry(peer_id.clone()).or_insert_with(Vec::new).push(msg.clone());
        }

        if let Some(ref handle) = self.app_handle {
            let _ = handle.emit("chat-message-sent", &msg);
        }

        Ok(msg)
    }

    pub async fn get_chat_history(&self, peer_id: &str) -> Vec<ChatMessage> {
        let hist = self.chat_history.read().await;
        hist.get(peer_id).cloned().unwrap_or_default()
    }
}

// Axum Handlers
async fn handle_ping(State(service): State<TransferService>) -> Json<serde_json::Value> {
    let id = service.identity.get_device_id().await;
    let name = service.identity.get_device_name().await;
    Json(json!({
        "status": "ok",
        "pong": true,
        "deviceId": id,
        "deviceName": name,
        "name": name,
        "platform": "windows",
        "port": TRANSFER_PORT,
        "transferPort": TRANSFER_PORT,
        "protocol": "AURADROP/1"
    }))
}

async fn handle_info(State(service): State<TransferService>) -> Json<serde_json::Value> {
    let id = service.identity.get_device_id().await;
    let name = service.identity.get_device_name().await;
    Json(json!({
        "deviceId": id,
        "deviceName": name,
        "platform": "windows"
    }))
}

async fn handle_prepare_upload(
    State(service): State<TransferService>,
    Json(payload): Json<PrepareUploadRequest>,
) -> Result<Json<PrepareUploadResponse>, (StatusCode, Json<serde_json::Value>)> {
    let token = Uuid::new_v4().to_string();
    let expires_at = Utc::now().timestamp_millis() + 60000;

    let sender_name = payload.sender_name.unwrap_or(payload.sender_user_id);
    let meta = SessionMetadata {
        transfer_id: payload.transfer_id.clone(),
        file_name: payload.file_name.clone(),
        file_size: payload.file_size,
        sha256_expected: payload.sha256.clone(),
        token: token.clone(),
        expires_at,
        sender_name: sender_name.clone(),
    };

    service
        .sessions
        .write()
        .await
        .insert(payload.transfer_id.clone(), meta);

    crate::log_debug(&format!(
        "[AuraTransfer] Prepare-upload accepted: {} ({} bytes) from {}",
        payload.file_name, payload.file_size, sender_name
    ));

    Ok(Json(PrepareUploadResponse {
        accepted: true,
        transfer_id: payload.transfer_id,
        file_id: payload.file_id,
        one_time_token: token,
        expires_at,
        protocol: "auradrop/1".to_string(),
    }))
}

async fn handle_upload(
    State(service): State<TransferService>,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let transfer_id = headers
        .get("x-transfer-id")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();

    let session = {
        let sessions = service.sessions.read().await;
        sessions.get(&transfer_id).cloned()
    };

    let session = match session {
        Some(s) => s,
        None => {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Unknown or expired transfer session"})),
            ));
        }
    };

    let target_file_path = service.downloads_dir.join(&session.file_name);
    let mut file = match File::create(&target_file_path) {
        Ok(f) => f,
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Cannot create file: {}", e)})),
            ));
        }
    };

    let mut hasher = Sha256::new();
    let mut transferred = 0u64;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    let mut stream = body.into_data_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                let _ = fs::remove_file(&target_file_path);
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": format!("Stream read error: {}", e)})),
                ));
            }
        };

        if let Err(e) = file.write_all(&chunk) {
            let _ = fs::remove_file(&target_file_path);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Disk write error: {}", e)})),
            ));
        }

        hasher.update(&chunk);
        transferred += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 200 || transferred == session.file_size {
            last_emit = Instant::now();
            let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
            let speed = (transferred as f64 / (1024.0 * 1024.0)) / elapsed;
            let remaining = session.file_size.saturating_sub(transferred);
            let eta = if speed > 0.0 {
                ((remaining as f64 / (1024.0 * 1024.0)) / speed).ceil() as u64
            } else {
                0
            };
            let percent = if session.file_size > 0 {
                (transferred as f64 / session.file_size as f64) * 100.0
            } else {
                100.0
            };

            service
                .emit_progress(TransferProgressPayload {
                    transfer_id: session.transfer_id.clone(),
                    file_name: session.file_name.clone(),
                    file_size: session.file_size,
                    bytes_transferred: transferred,
                    progress_percent: percent,
                    speed_mbps: speed,
                    eta_seconds: eta,
                    is_incoming: true,
                    status: if transferred >= session.file_size {
                        "completed".to_string()
                    } else {
                        "transferring".to_string()
                    },
                    peer_name: "Remote Peer".to_string(),
                    error: None,
                    file_path: None,
                })
                .await;
        }
    }

    let calculated_hash = hex::encode(hasher.finalize());
    let verified = calculated_hash.eq_ignore_ascii_case(&session.sha256_expected);

    // Remove session
    service.sessions.write().await.remove(&transfer_id);

    crate::log_debug(&format!(
        "[AuraTransfer] Inbound upload complete: {} ({} bytes) - SHA-256: {} [Verified: {}] -> Saved to {}",
        session.file_name, session.file_size, calculated_hash, verified, target_file_path.display()
    ));

    // Emit final completed incoming transfer event to desktop UI
    service
        .emit_progress(TransferProgressPayload {
            transfer_id: session.transfer_id.clone(),
            file_name: session.file_name.clone(),
            file_size: session.file_size,
            bytes_transferred: session.file_size,
            progress_percent: 100.0,
            speed_mbps: 0.0,
            eta_seconds: 0,
            is_incoming: true,
            status: "completed".to_string(),
            peer_name: session.sender_name.clone(),
            error: None,
            file_path: Some(target_file_path.to_string_lossy().to_string()),
        })
        .await;

    Ok(Json(json!({
        "success": true,
        "transferId": transfer_id,
        "verified": verified,
        "sha256Verified": verified,
        "sha256": calculated_hash,
        "savedPath": target_file_path.to_string_lossy()
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncomingChatMessage {
    pub id: Option<String>,
    pub sender_id: Option<String>,
    pub sender_name: Option<String>,
    pub text: String,
    pub timestamp: Option<i64>,
}

async fn handle_chat(
    State(service): State<TransferService>,
    Json(payload): Json<IncomingChatMessage>,
) -> Json<serde_json::Value> {
    let now = Utc::now().timestamp_millis();
    let id = payload.id.unwrap_or_else(|| format!("msg_{}", Uuid::new_v4().simple()));
    let sender_id = payload.sender_id.unwrap_or_else(|| "remote_peer".to_string());
    let sender_name = payload.sender_name.unwrap_or_else(|| "Nearby Device".to_string());

    let msg = ChatMessage {
        id,
        peer_id: sender_id.clone(),
        peer_name: sender_name.clone(),
        sender_id: sender_id.clone(),
        sender_name: sender_name.clone(),
        text: payload.text,
        timestamp: payload.timestamp.unwrap_or(now),
        is_outgoing: false,
    };

    {
        let mut hist = service.chat_history.write().await;
        hist.entry(sender_id).or_insert_with(Vec::new).push(msg.clone());
    }

    if let Some(ref handle) = service.app_handle {
        let _ = handle.emit("chat-message-received", &msg);
    }

    crate::log_debug(&format!("[AuraChat] Message received from {}: {}", msg.peer_name, msg.text));

    Json(json!({ "status": "ok", "delivered": true }))
}
