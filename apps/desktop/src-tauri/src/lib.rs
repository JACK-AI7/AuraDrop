pub mod commands;
pub mod discovery;
pub mod identity;
pub mod models;
pub mod network;
pub mod transfer;

use commands::{
    get_local_info, get_nearby_peers, open_downloads_folder, pick_files, probe_device_ip,
    rescan_network, send_files_to_peer, set_device_name, AppState,
};
use discovery::DiscoveryService;
use identity::IdentityManager;
use std::fs::OpenOptions;
use std::io::Write;
use tauri::Manager;
use transfer::TransferService;

pub fn log_debug(msg: &str) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("C:\\Users\\bjasw\\Downloads\\AuraDrop-Windows\\debug.log")
    {
        let _ = writeln!(f, "[{}] {}", chrono::Local::now().format("%H:%M:%S%.3f"), msg);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_debug("run() called");
    let identity = IdentityManager::init();
    log_debug("identity initialized");
    let discovery = DiscoveryService::new(identity.clone());
    let transfer = TransferService::new(identity.clone());

    let res = tauri::Builder::default()
        .setup({
            let discovery = discovery.clone();
            let transfer = transfer.clone();
            let identity = identity.clone();

            move |app| {
                log_debug("setup() hook running");
                let handle = app.handle().clone();
                let mut d = discovery.clone();
                let mut t = transfer.clone();
                d.set_app_handle(handle.clone());
                t.set_app_handle(handle.clone());

                log_debug("starting discovery & transfer server");
                d.start();
                t.start_server();

                app.manage(AppState {
                    identity,
                    discovery: d,
                    transfer: t,
                });
                log_debug("setup() complete");

                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_local_info,
            set_device_name,
            get_nearby_peers,
            pick_files,
            send_files_to_peer,
            open_downloads_folder,
            rescan_network,
            probe_device_ip
        ])
        .run(tauri::generate_context!());

    match res {
        Ok(_) => log_debug("tauri app exited normally with Ok(())"),
        Err(e) => log_debug(&format!("tauri app exited with Error: {:?}", e)),
    }
}
