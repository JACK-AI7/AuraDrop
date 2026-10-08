use local_ip_address::list_afinet_netifas;
use std::net::{IpAddr, Ipv4Addr};

#[derive(Debug, Clone)]
pub struct NetworkTarget {
    pub interface_name: String,
    pub ip: Ipv4Addr,
    pub broadcast: Ipv4Addr,
}

pub struct NetworkManager;

impl NetworkManager {
    const VIRTUAL_KEYWORDS: &'static [&'static str] = &[
        "vethernet",
        "wsl",
        "hyper-v",
        "virtualbox",
        "vmware",
        "docker",
        "tap",
        "tun",
        "tailscale",
        "zerotier",
        "loopback",
    ];

    pub fn get_broadcast_targets() -> Vec<NetworkTarget> {
        let mut targets = Vec::new();

        if let Ok(interfaces) = list_afinet_netifas() {
            for (name, ip) in interfaces {
                let name_lower = name.to_lowercase();
                let is_virtual = Self::VIRTUAL_KEYWORDS.iter().any(|kw| name_lower.contains(kw));
                if is_virtual {
                    continue;
                }

                if let IpAddr::V4(ipv4) = ip {
                    let octets = ipv4.octets();
                    // Ignore loopback (127.x.x.x) and link-local (169.254.x.x)
                    if octets[0] == 127 || (octets[0] == 169 && octets[1] == 254) {
                        continue;
                    }

                    // Compute standard /24 directed subnet broadcast (a.b.c.255)
                    let broadcast = Ipv4Addr::new(octets[0], octets[1], octets[2], 255);
                    targets.push(NetworkTarget {
                        interface_name: name,
                        ip: ipv4,
                        broadcast,
                    });
                }
            }
        }

        targets
    }

    pub fn get_primary_physical_ip() -> (String, String) {
        let targets = Self::get_broadcast_targets();

        // 1. Prefer private LAN ranges (192.168.x.x, 10.x.x.x, 172.16..31.x.x)
        for target in &targets {
            let octets = target.ip.octets();
            if (octets[0] == 192 && octets[1] == 168)
                || octets[0] == 10
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
            {
                return (target.ip.to_string(), target.interface_name.clone());
            }
        }

        if let Some(first) = targets.first() {
            return (first.ip.to_string(), first.interface_name.clone());
        }

        ("127.0.0.1".to_string(), "Loopback".to_string())
    }
}
