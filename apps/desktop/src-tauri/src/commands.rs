use crate::discovery::DiscoveryService;
use crate::identity::IdentityManager;
use crate::models::{ChatMessage, LocalDeviceInfo, PeerDevice, SelectedFileInfo};
use crate::network::NetworkManager;
use crate::transfer::{TransferService, TRANSFER_PORT};
use std::fs;
use tauri::State;

pub struct AppState {
    pub identity: IdentityManager,
    pub discovery: DiscoveryService,
    pub transfer: TransferService,
}

#[tauri::command]
pub async fn get_local_info(state: State<'_, AppState>) -> Result<LocalDeviceInfo, String> {
    let device_id = state.identity.get_device_id().await;
    let device_name = state.identity.get_device_name().await;
    let (active_ip, active_interface) = NetworkManager::get_primary_physical_ip();
    let downloads_dir = state.transfer.get_downloads_dir();

    Ok(LocalDeviceInfo {
        device_id,
        device_name,
        platform: "windows".to_string(),
        active_ip,
        active_interface,
        port: TRANSFER_PORT,
        downloads_dir,
    })
}

#[tauri::command]
pub async fn set_device_name(name: String, state: State<'_, AppState>) -> Result<(), String> {
    state.identity.set_device_name(name).await;
    Ok(())
}

#[tauri::command]
pub async fn get_nearby_peers(state: State<'_, AppState>) -> Result<Vec<PeerDevice>, String> {
    Ok(state.discovery.get_peers().await)
}

#[tauri::command]
pub async fn pick_files() -> Result<Vec<SelectedFileInfo>, String> {
    let files = rfd::FileDialog::new()
        .set_title("Select Files to Send via AuraDrop")
        .pick_files();

    let mut result = Vec::new();
    if let Some(paths) = files {
        for path in paths {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            result.push(SelectedFileInfo {
                name,
                path: path.to_string_lossy().to_string(),
                size,
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn send_files_to_peer(
    peer_id: String,
    file_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let peers = state.discovery.get_peers().await;
    let peer = peers
        .into_iter()
        .find(|p| p.id == peer_id)
        .ok_or_else(|| "Peer device not found".to_string())?;

    let transfer = state.transfer.clone();
    let peer_ip = peer.ip;
    let peer_port = peer.port;
    let peer_name = peer.name;

    tauri::async_runtime::spawn(async move {
        for path in file_paths {
            let _ = transfer
                .send_file(peer_ip.clone(), peer_port, path, peer_name.clone())
                .await;
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn open_downloads_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.transfer.get_downloads_dir();
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&dir).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&dir).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
    }
    Ok(())
}

#[tauri::command]
pub async fn rescan_network(state: State<'_, AppState>) -> Result<Vec<PeerDevice>, String> {
    crate::log_debug("[Commands] rescan_network invoked by user");
    state.discovery.trigger_scan().await;
    Ok(state.discovery.get_peers().await)
}

#[tauri::command]
pub async fn probe_device_ip(ip: String, state: State<'_, AppState>) -> Result<PeerDevice, String> {
    crate::log_debug(&format!("[Commands] probe_device_ip invoked for: {}", ip));
    state.discovery.probe_single_ip(&ip).await
}

#[tauri::command]
pub async fn send_chat_message(
    peer_id: String,
    text: String,
    peer_ip: Option<String>,
    peer_port: Option<u16>,
    peer_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<ChatMessage, String> {
    crate::log_debug(&format!(
        "[Commands] send_chat_message to peer_id: {}, peer_ip: {:?}, peer_port: {:?}",
        peer_id, peer_ip, peer_port
    ));

    let (ip, port, name) = if let (Some(ip_str), Some(p)) = (peer_ip, peer_port) {
        let name_str = peer_name.unwrap_or_else(|| "Peer".to_string());
        (ip_str, p, name_str)
    } else {
        let peers = state.discovery.get_peers().await;
        let peer = peers
            .into_iter()
            .find(|p| p.id == peer_id)
            .ok_or_else(|| "Peer device not found in active discovery cache".to_string())?;
        (peer.ip, peer.port, peer.name)
    };

    state
        .transfer
        .send_chat(ip, port, peer_id, name, text)
        .await
}

#[tauri::command]
pub async fn get_chat_history(
    peer_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChatMessage>, String> {
    Ok(state.transfer.get_chat_history(&peer_id).await)
}

#[tauri::command]
pub async fn get_all_chat_conversations(
    state: State<'_, AppState>,
) -> Result<Vec<ChatMessage>, String> {
    Ok(state.transfer.get_all_chat_messages().await)
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub download_url: Option<String>,
    pub pub_date: String,
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = match reqwest::Client::builder()
        .user_agent("AuraDrop-Desktop/2.0")
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(UpdateCheckResult {
                has_update: false,
                current_version: current_version.clone(),
                latest_version: current_version,
                release_notes: format!("Could not initialize network client: {}", e),
                download_url: None,
                pub_date: "Offline".to_string(),
            });
        }
    };

    // 1. Try GitHub Releases API
    let res = client
        .get("https://api.github.com/repos/JACK-AI7/AuraDrop/releases/latest")
        .send()
        .await;

    if let Ok(resp) = res {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let tag = json["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
                let body = json["body"].as_str().unwrap_or("").to_string();
                let published_at = json["published_at"].as_str().unwrap_or("").to_string();

                let mut download_url = None;
                if let Some(assets) = json["assets"].as_array() {
                    for asset in assets {
                        let name = asset["name"].as_str().unwrap_or("");
                        if name.ends_with(".exe") || name.ends_with(".msi") {
                            download_url = asset["browser_download_url"].as_str().map(|s| s.to_string());
                            break;
                        }
                    }
                }

                if !tag.is_empty() {
                    let has_update = is_newer_version(&tag, &current_version);
                    return Ok(UpdateCheckResult {
                        has_update,
                        current_version,
                        latest_version: tag,
                        release_notes: if body.is_empty() { "Bug fixes and performance improvements.".to_string() } else { body },
                        download_url,
                        pub_date: published_at,
                    });
                }
            }
        }
    }

    // 2. Fallback to raw version.json
    let raw_res = client
        .get("https://raw.githubusercontent.com/JACK-AI7/AuraDrop/main/version.json")
        .send()
        .await;

    if let Ok(resp) = raw_res {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let v = json["version"].as_str().unwrap_or("").trim_start_matches('v').to_string();
                let notes = json["release_notes"].as_str().unwrap_or("").to_string();
                let windows_url = json["downloads"]["windows"].as_str().map(|s| s.to_string());
                let pub_date = json["release_date"].as_str().unwrap_or("").to_string();
                let has_update = is_newer_version(&v, &current_version);

                return Ok(UpdateCheckResult {
                    has_update,
                    current_version,
                    latest_version: v,
                    release_notes: notes,
                    download_url: windows_url,
                    pub_date,
                });
            }
        }
    }

    Ok(UpdateCheckResult {
        has_update: false,
        current_version: current_version.clone(),
        latest_version: current_version,
        release_notes: "You are running the latest version of AuraDrop.".to_string(),
        download_url: None,
        pub_date: "Up to date".to_string(),
    })
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse_parts = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|s| s.trim_start_matches('v').split('-').next().unwrap_or("0").parse::<u32>().ok())
            .collect()
    };
    let l_parts = parse_parts(latest);
    let c_parts = parse_parts(current);

    for (l, c) in l_parts.iter().zip(c_parts.iter()) {
        if l > c {
            return true;
        } else if l < c {
            return false;
        }
    }
    l_parts.len() > c_parts.len()
}

#[tauri::command]
pub async fn show_file_in_folder(
    file_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let downloads = state.transfer.get_downloads_dir();
    let p = std::path::Path::new(&file_name);
    let target = if p.is_absolute() && p.exists() {
        p.to_path_buf()
    } else {
        std::path::Path::new(&downloads).join(&file_name)
    };

    #[cfg(target_os = "windows")]
    {
        if target.exists() {
            let _ = std::process::Command::new("explorer")
                .args(["/select,", &target.to_string_lossy()])
                .spawn();
        } else {
            let _ = std::process::Command::new("explorer").arg(&downloads).spawn();
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg("-R").arg(&target).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&downloads).spawn();
    }
    Ok(())
}

#[tauri::command]
pub async fn open_file(
    file_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let downloads = state.transfer.get_downloads_dir();
    let p = std::path::Path::new(&file_name);
    let target = if p.is_absolute() && p.exists() {
        p.to_path_buf()
    } else {
        std::path::Path::new(&downloads).join(&file_name)
    };

    #[cfg(target_os = "windows")]
    {
        let path_str = if target.exists() {
            target.to_string_lossy().to_string()
        } else {
            downloads.clone()
        };
        let _ = std::process::Command::new("explorer")
            .arg(&path_str)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&target).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&target).spawn();
    }
    Ok(())
}

