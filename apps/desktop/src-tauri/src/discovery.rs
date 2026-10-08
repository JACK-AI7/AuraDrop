use crate::identity::IdentityManager;
use crate::models::{DiscoveryPacket, PeerDevice};
use crate::network::NetworkManager;
use chrono::Utc;
use reqwest::Client;
use serde_json::Value;
use socket2::{Domain, Protocol, Socket, Type};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;
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
    http_client: Client,
    pub socket: Arc<RwLock<Option<Arc<UdpSocket>>>>,
}

impl DiscoveryService {
    pub async fn trigger_scan(&self) {
        if let Some(sock) = self.socket.read().await.as_ref() {
            self.scan_subnet(sock.clone()).await;
        }
    }
    pub fn new(identity: IdentityManager) -> Self {
        let http_client = Client::builder()
            .timeout(Duration::from_millis(600))
            .connect_timeout(Duration::from_millis(400))
            .build()
            .unwrap_or_default();

        Self {
            identity,
            peers: Arc::new(RwLock::new(HashMap::new())),
            app_handle: None,
            http_client,
            socket: Arc::new(RwLock::new(None)),
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
                    let err_msg = format!("[Discovery] Failed to bind UDP socket: {}", e);
                    crate::log_debug(&err_msg);
                    eprintln!("{}", err_msg);
                    return;
                }
            };

            {
                let mut sock_guard = service.socket.write().await;
                *sock_guard = Some(socket.clone());
            }

            // Spawn Broadcast & Subnet Sweeper Task
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

            // Immediate initial active subnet sweep
            let sweep_service = service.clone();
            let sweep_socket = socket.clone();
            tauri::async_runtime::spawn(async move {
                sweep_service.scan_subnet(sweep_socket).await;
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
                crate::log_debug(&format!("[Discovery] Successfully bound UDP socket on 0.0.0.0:{}", DISCOVERY_PORT));
                socket.into()
            }
            Err(e) => {
                crate::log_debug(&format!("[Discovery] Port {} busy ({}), binding dynamic fallback UDP port", DISCOVERY_PORT, e));
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
            match socket.send_to(&payload, target_addr).await {
                Ok(_) => {
                    // Packet sent successfully
                }
                Err(e) => {
                    // Log error for diagnostics
                    if packet_type == "ANNOUNCE_ACK" {
                        crate::log_debug(&format!("[Discovery] Failed to send {} to {}: {}", packet_type, target_addr, e));
                    }
                }
            }
        }
    }

    /// Active Subnet Sweeper: Sends direct unicast UDP + HTTP probe to every host on the /24 subnet.
    /// This completely bypasses router broadcast/multicast blocking on hostel, campus, and hotel Wi-Fi!
    pub async fn scan_subnet(&self, socket: Arc<UdpSocket>) {
        let targets = NetworkManager::get_broadcast_targets();
        let my_id = self.identity.get_device_id().await;

        for target in targets {
            let octets = target.ip.octets();
            let my_host = octets[3];

            // Probe all 254 potential hosts on the subnet concurrently in batches
            let mut tasks = Vec::with_capacity(254);

            for host in 1..=254 {
                if host == my_host {
                    continue; // Skip self
                }

                let target_ip = Ipv4Addr::new(octets[0], octets[1], octets[2], host);
                let udp_addr = SocketAddr::V4(SocketAddrV4::new(target_ip, DISCOVERY_PORT));

                // 1. Fire direct UDP Announce Unicast
                let s_clone = self.clone();
                let sock_clone = socket.clone();
                tasks.push(tokio::spawn(async move {
                    s_clone.send_announce(&sock_clone, udp_addr, "ANNOUNCE").await;
                }));

                // 2. Fire direct HTTP GET ping probe
                let s_clone2 = self.clone();
                let my_id_clone = my_id.clone();
                let sock_clone2 = socket.clone();
                tasks.push(tokio::spawn(async move {
                    let probe_url = format!("http://{}:{}/api/auradrop/v1/ping", target_ip, DISCOVERY_PORT);
                    if let Ok(resp) = s_clone2.http_client.get(&probe_url).send().await {
                        if resp.status().is_success() {
                            if let Ok(json) = resp.json::<Value>().await {
                                let remote_id = json.get("deviceId")
                                    .or_else(|| json.get("id"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();

                                if !remote_id.is_empty() && remote_id != my_id_clone {
                                    let remote_name = json.get("deviceName")
                                        .or_else(|| json.get("name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Nearby Device")
                                        .to_string();

                                    let platform = json.get("platform")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("device")
                                        .to_lowercase();

                                    let port = json.get("port")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(DISCOVERY_PORT as u64) as u16;

                                    let peer = PeerDevice {
                                        id: remote_id.clone(),
                                        name: remote_name.clone(),
                                        platform: platform.clone(),
                                        ip: target_ip.to_string(),
                                        port,
                                        status: "Online".to_string(),
                                        version: "1.0.0".to_string(),
                                        last_seen_ms: Utc::now().timestamp_millis(),
                                        is_online: true,
                                    };

                                    crate::log_debug(&format!(
                                        "[AuraNet] HTTP probe discovered peer {}:{} - {} [{}] (ID: {})",
                                        target_ip, port, peer.name, peer.platform, peer.id
                                    ));

                                    // Add to peers map
                                    {
                                        let mut peers = s_clone2.peers.write().await;
                                        peers.insert(peer.id.clone(), peer);
                                    }

                                    // Emit peer update to UI
                                    s_clone2.emit_peers_updated().await;

                                    // Send direct UDP announce straight back to peer
                                    s_clone2.send_announce(&sock_clone2, udp_addr, "ANNOUNCE_ACK").await;
                                }
                            }
                        }
                    }
                }));
            }

            // Await all probes
            for task in tasks {
                let _ = task.await;
            }
        }
    }

    /// Single IP Probe: Direct check of a specified IP address.
    pub async fn probe_single_ip(&self, ip_str: &str) -> Result<PeerDevice, String> {
        let ip: Ipv4Addr = ip_str.trim().parse().map_err(|e| format!("Invalid IP address: {}", e))?;
        let _my_id = self.identity.get_device_id().await;
        let probe_url = format!("http://{}:{}/api/auradrop/v1/ping", ip, DISCOVERY_PORT);

        // Try HTTP probe first
        match self.http_client.get(&probe_url).timeout(Duration::from_millis(1200)).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    let json: Value = resp.json().await.map_err(|e| format!("Invalid JSON response: {}", e))?;
                    let remote_id = json.get("deviceId")
                        .or_else(|| json.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown_id")
                        .to_string();

                    let remote_name = json.get("deviceName")
                        .or_else(|| json.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Nearby Device")
                        .to_string();

                    let platform = json.get("platform")
                        .and_then(|v| v.as_str())
                        .unwrap_or("device")
                        .to_lowercase();

                    let port = json.get("port")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(DISCOVERY_PORT as u64) as u16;

                    let peer = PeerDevice {
                        id: remote_id.clone(),
                        name: remote_name,
                        platform,
                        ip: ip.to_string(),
                        port,
                        status: "Online".to_string(),
                        version: "1.0.0".to_string(),
                        last_seen_ms: Utc::now().timestamp_millis(),
                        is_online: true,
                    };

                    crate::log_debug(&format!(
                        "[AuraNet] Direct manual probe succeeded for {}: {} [{}]",
                        ip, peer.name, peer.id
                    ));

                    // Store and emit
                    {
                        let mut peers = self.peers.write().await;
                        peers.insert(peer.id.clone(), peer.clone());
                    }
                    self.emit_peers_updated().await;

                    // Send UDP announce if socket available
                    if let Some(sock) = self.socket.read().await.as_ref() {
                        let udp_addr = SocketAddr::V4(SocketAddrV4::new(ip, DISCOVERY_PORT));
                        self.send_announce(sock, udp_addr, "ANNOUNCE").await;
                    }

                    return Ok(peer);
                } else {
                    return Err(format!("Device at {} returned HTTP status {}", ip, resp.status()));
                }
            }
            Err(e) => {
                // If HTTP probe failed, send direct UDP packet and return error message
                if let Some(sock) = self.socket.read().await.as_ref() {
                    let udp_addr = SocketAddr::V4(SocketAddrV4::new(ip, DISCOVERY_PORT));
                    self.send_announce(sock, udp_addr, "ANNOUNCE").await;
                }
                return Err(format!("Could not connect to {}:{}: {}", ip, DISCOVERY_PORT, e));
            }
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

            // 5. Run continuous Active Subnet Sweep in background
            let service_clone = self.clone();
            let socket_clone = socket.clone();
            tauri::async_runtime::spawn(async move {
                service_clone.scan_subnet(socket_clone).await;
            });

            tokio::time::sleep(tokio::time::Duration::from_millis(3500)).await;
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
                        let proto = packet.protocol.to_uppercase();
                        if !proto.is_empty()
                            && proto != "AURADROP/1"
                            && proto != "P2PFS/1"
                            && proto != "AURADROP_LOCAL_V1"
                        {
                            continue;
                        }

                        if packet.device_id.is_empty() || packet.device_id == my_id {
                            continue;
                        }

                        let src_ip = match src {
                            SocketAddr::V4(v4) => v4.ip().to_string(),
                            SocketAddr::V6(v6) => v6.ip().to_string(),
                        };

                        let port = packet.transfer_port.or(packet.port).unwrap_or(DISCOVERY_PORT);
                        let name = if !packet.device_name.is_empty() {
                            packet.device_name
                        } else if !packet.name.is_empty() {
                            packet.name
                        } else {
                            "Nearby Device".to_string()
                        };

                        let platform = if !packet.platform.is_empty() {
                            packet.platform.to_lowercase()
                        } else {
                            "android".to_string()
                        };

                        let peer = PeerDevice {
                            id: packet.device_id.clone(),
                            name,
                            platform,
                            ip: src_ip.clone(),
                            port,
                            status: packet.status.unwrap_or_else(|| "Online".to_string()),
                            version: packet.version.unwrap_or_else(|| "1.0.0".to_string()),
                            last_seen_ms: Utc::now().timestamp_millis(),
                            is_online: true,
                        };

                        crate::log_debug(&format!(
                            "[AuraNet] UDP Received {} ({}) from {}:{} - Device: {} [{}] (ID: {})",
                            packet.protocol, packet.packet_type, src_ip, port, peer.name, peer.platform, peer.id
                        ));

                        // Respond with unicast ACK if it was an ANNOUNCE or BEACON
                        if packet.packet_type == "ANNOUNCE" || packet.packet_type == "AURADROP_BEACON" {
                            // 1. Reply to socket sender address
                            self.send_announce(&socket, src, "ANNOUNCE_ACK").await;
                            // 2. Also reply directly to DISCOVERY_PORT on the sender's IP in case sender socket was ephemeral!
                            let daemon_addr = SocketAddr::new(src.ip(), DISCOVERY_PORT);
                            if daemon_addr != src {
                                self.send_announce(&socket, daemon_addr, "ANNOUNCE_ACK").await;
                            }
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
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            let now = Utc::now().timestamp_millis();
            let mut changed = false;

            {
                let mut peers = self.peers.write().await;
                let before_count = peers.len();
                // Prune if not seen for > 12 seconds
                peers.retain(|_, peer| now - peer.last_seen_ms <= 12000);
                if peers.len() != before_count {
                    changed = true;
                }
            }

            if changed {
                self.emit_peers_updated().await;
            }
        }
    }

    pub async fn emit_peers_updated(&self) {
        if let Some(ref handle) = self.app_handle {
            let list = self.get_peers().await;
            let _ = handle.emit("peers-updated", list);
        }
    }
}
