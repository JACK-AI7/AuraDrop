use crate::discovery::DiscoveryService;
use crate::identity::IdentityManager;
use crate::models::{LocalDeviceInfo, PeerDevice, SelectedFileInfo};
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
pub async fn rescan_network(_state: State<'_, AppState>) -> Result<(), String> {
    // Triggers network check
    Ok(())
}
