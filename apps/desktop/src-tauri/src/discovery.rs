use crate::identity::IdentityManager;
use crate::models::{DiscoveryPacket, PeerDevice};
use crate::network::NetworkManager;
use chrono::Utc;
use socket2::{Domain, Protocol, Socket, Type};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;
use tokio::sync::RwLock;

pub const DISCOVERY_PORT: u16 = 53317;
pub const MULTICAST_IPV4: &str = "224.0.0.167";
pub const LEGACY_MULTICAST: &str = "239.255.48.29";

#[derive(Clone)]
pub struct DiscoveryService {
    identity: IdentityManager,
    peers: Arc<RwLock<HashMap<String, PeerDevice>>>,
    app_handle: Option<AppHandle>,
}

impl DiscoveryService {
    pub fn new(identity: IdentityManager) -> Self {
        Self {
            identity,
            peers: Arc::new(RwLock::new(HashMap::new())),
            app_handle: None,
        }
    }

    pub fn set_app_handle(&mut self, app_handle: AppHandle) {
        self.app_handle = Some(app_handle);
    }

    pub async fn get_peers(&self) -> Vec<PeerDevice> {
        self.peers.read().await.values().cloned().collect()
    }

    pub fn start(&self) {
        let service = self.clone();

        tauri::async_runtime::spawn(async move {
            let socket = match Self::create_udp_socket().await {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    eprintln!("[Discovery] Failed to bind UDP socket: {}", e);
                    return;
                }
            };

            // Spawn Broadcast Sender Task
            let sender_socket = socket.clone();
            let sender_service = service.clone();
            tauri::async_runtime::spawn(async move {
                sender_service.run_broadcast_loop(sender_socket).await;
            });

            // Spawn Listener Task
            let listener_socket = socket.clone();
            let listener_service = service.clone();
            tauri::async_runtime::spawn(async move {
                listener_service.run_listen_loop(listener_socket).await;
            });

            // Spawn Prune Task
            let prune_service = service.clone();
            tauri::async_runtime::spawn(async move {
                prune_service.run_prune_loop().await;
            });
        });
    }

    async fn create_udp_socket() -> Result<UdpSocket, Box<dyn std::error::Error + Send + Sync>> {
        let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
        let _ = socket.set_reuse_address(true);
        let _ = socket.set_broadcast(true);
        let _ = socket.set_nonblocking(true);

        // Try primary port 53317 first
        let bind_addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT);
        let std_socket = match socket.bind(&bind_addr.into()) {
            Ok(_) => {
                println!("[Discovery] Bound UDP socket on port {}", DISCOVERY_PORT);
                socket.into()
            }
            Err(_) => {
                println!("[Discovery] Port {} busy, binding dynamic UDP port", DISCOVERY_PORT);
                let fallback_socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
                let _ = fallback_socket.set_reuse_address(true);
                let _ = fallback_socket.set_broadcast(true);
                let _ = fallback_socket.set_nonblocking(true);
                let fallback_addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0);
                fallback_socket.bind(&fallback_addr.into())?;
                fallback_socket.into()
            }
        };

        let udp = UdpSocket::from_std(std_socket)?;

        // Join Multicast Groups
        if let Ok(mcast_addr) = MULTICAST_IPV4.parse::<Ipv4Addr>() {
            let _ = udp.join_multicast_v4(mcast_addr, Ipv4Addr::UNSPECIFIED);
        }
        if let Ok(legacy_addr) = LEGACY_MULTICAST.parse::<Ipv4Addr>() {
            let _ = udp.join_multicast_v4(legacy_addr, Ipv4Addr::UNSPECIFIED);
        }

        Ok(udp)
    }

    pub async fn send_announce(
        &self,
        socket: &UdpSocket,
        target_addr: SocketAddr,
        packet_type: &str,
    ) {
        let device_id = self.identity.get_device_id().await;
        let device_name = self.identity.get_device_name().await;
        let now = Utc::now().timestamp_millis();

        let packet = DiscoveryPacket {
            protocol: "AURADROP/1".to_string(),
            packet_type: packet_type.to_string(),
            device_id,
            name: device_name.clone(),
            device_name,
            platform: "windows".to_string(),
            port: Some(DISCOVERY_PORT),
            transfer_port: Some(DISCOVERY_PORT),
            version: Some("1.0.0".to_string()),
            status: Some("Nearby sharing made effortless".to_string()),
            timestamp: Some(now),
        };

        if let Ok(payload) = serde_json::to_vec(&packet) {
            let _ = socket.send_to(&payload, target_addr).await;
        }
    }

    async fn run_broadcast_loop(&self, socket: Arc<UdpSocket>) {
        loop {
            let targets = NetworkManager::get_broadcast_targets();

            // 1. Send to directed subnet broadcast of all physical interfaces
            for target in &targets {
                let addr = SocketAddr::V4(SocketAddrV4::new(target.broadcast, DISCOVERY_PORT));
                self.send_announce(&socket, addr, "ANNOUNCE").await;
            }

            // 2. Global Broadcast 255.255.255.255
            let global_bcast = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::BROADCAST, DISCOVERY_PORT));
            self.send_announce(&socket, global_bcast, "ANNOUNCE").await;

            // 3. Multicast 224.0.0.167
            if let Ok(mcast) = MULTICAST_IPV4.parse::<Ipv4Addr>() {
                let mcast_addr = SocketAddr::V4(SocketAddrV4::new(mcast, DISCOVERY_PORT));
                self.send_announce(&socket, mcast_addr, "ANNOUNCE").await;
            }

            // 4. Legacy Multicast 239.255.48.29
            if let Ok(legacy) = LEGACY_MULTICAST.parse::<Ipv4Addr>() {
                let legacy_addr = SocketAddr::V4(SocketAddrV4::new(legacy, DISCOVERY_PORT));
                self.send_announce(&socket, legacy_addr, "ANNOUNCE").await;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
        }
    }

    async fn run_listen_loop(&self, socket: Arc<UdpSocket>) {
        let mut buf = vec![0u8; 65535];
        let my_id = self.identity.get_device_id().await;

        loop {
            match socket.recv_from(&mut buf).await {
                Ok((len, src)) => {
                    let slice = &buf[..len];
                    if let Ok(packet) = serde_json::from_slice::<DiscoveryPacket>(slice) {
                        if packet.protocol != "AURADROP/1" || packet.device_id == my_id {
                            continue;
                        }

                        let src_ip = match src {
                            SocketAddr::V4(v4) => v4.ip().to_string(),
                            SocketAddr::V6(v6) => v6.ip().to_string(),
                        };

                        let port = packet.transfer_port.or(packet.port).unwrap_or(DISCOVERY_PORT);
                        let name = if !packet.device_name.is_empty() {
                            packet.device_name
                        } else {
                            packet.name
                        };

                        let peer = PeerDevice {
                            id: packet.device_id.clone(),
                            name,
                            platform: packet.platform.to_lowercase(),
                            ip: src_ip,
                            port,
                            status: packet.status.unwrap_or_else(|| "Online".to_string()),
                            version: packet.version.unwrap_or_else(|| "1.0.0".to_string()),
                            last_seen_ms: Utc::now().timestamp_millis(),
                            is_online: true,
                        };

                        // Respond with unicast ACK if it was an ANNOUNCE
                        if packet.packet_type == "ANNOUNCE" {
                            self.send_announce(&socket, src, "ANNOUNCE_ACK").await;
                        }

                        // Store in peers map
                        {
                            let mut peers = self.peers.write().await;
                            peers.insert(peer.id.clone(), peer);
                        }

                        self.emit_peers_updated().await;
                    }
                }
                Err(_e) => {
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }
            }
        }
    }

    async fn run_prune_loop(&self) {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            let now = Utc::now().timestamp_millis();
            let mut changed = false;

            {
                let mut peers = self.peers.write().await;
                let before_count = peers.len();
                // Prune if not seen for > 8 seconds
                peers.retain(|_, peer| now - peer.last_seen_ms <= 8000);
                if peers.len() != before_count {
                    changed = true;
                }
            }

            if changed {
                self.emit_peers_updated().await;
            }
        }
    }

    async fn emit_peers_updated(&self) {
        if let Some(ref handle) = self.app_handle {
            let list = self.get_peers().await;
            let _ = handle.emit("peers-updated", list);
        }
    }
}
