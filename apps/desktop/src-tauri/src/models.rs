use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub ip: String,
    pub port: u16,
    pub status: String,
    pub version: String,
    pub last_seen_ms: i64,
    pub is_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub active_ip: String,
    pub active_interface: String,
    pub port: u16,
    pub downloads_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedFileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressPayload {
    pub transfer_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub bytes_transferred: u64,
    pub progress_percent: f64,
    pub speed_mbps: f64,
    pub eta_seconds: u64,
    pub is_incoming: bool,
    pub status: String, // "transferring", "completed", "failed", "canceled"
    pub peer_name: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryPacket {
    #[serde(default)]
    pub protocol: String,
    #[serde(rename = "type", alias = "packetType", default)]
    pub packet_type: String,
    #[serde(rename = "deviceId", alias = "id", default)]
    pub device_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(rename = "deviceName", default)]
    pub device_name: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(rename = "transferPort", default)]
    pub transfer_port: Option<u16>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub timestamp: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUploadRequest {
    pub transfer_id: String,
    pub file_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub sha256: String,
    pub sender_user_id: String,
    pub receiver_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUploadResponse {
    pub accepted: bool,
    pub transfer_id: String,
    pub file_id: String,
    pub one_time_token: String,
    pub expires_at: i64,
    pub protocol: String,
}
