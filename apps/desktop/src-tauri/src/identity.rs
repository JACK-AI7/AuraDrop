use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityData {
    pub device_id: String,
    pub device_name: String,
}

#[derive(Clone)]
pub struct IdentityManager {
    data: Arc<RwLock<IdentityData>>,
    config_path: PathBuf,
}

impl IdentityManager {
    pub fn init() -> Self {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("AuraDrop");

        if !config_dir.exists() {
            let _ = fs::create_dir_all(&config_dir);
        }

        let config_path = config_dir.join("identity.json");

        let identity = if config_path.exists() {
            match fs::read_to_string(&config_path) {
                Ok(content) => serde_json::from_str::<IdentityData>(&content).unwrap_or_else(|_| {
                    Self::generate_new_identity()
                }),
                Err(_) => Self::generate_new_identity(),
            }
        } else {
            let new_id = Self::generate_new_identity();
            if let Ok(json) = serde_json::to_string_pretty(&new_id) {
                let _ = fs::write(&config_path, json);
            }
            new_id
        };

        Self {
            data: Arc::new(RwLock::new(identity)),
            config_path,
        }
    }

    fn generate_new_identity() -> IdentityData {
        let device_id = Uuid::new_v4().to_string();
        let short_id = device_id[..4].to_string();
        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Desktop".to_string());

        IdentityData {
            device_id,
            device_name: format!("{} ({})", hostname, short_id),
        }
    }

    pub async fn get_device_id(&self) -> String {
        self.data.read().await.device_id.clone()
    }

    pub async fn get_device_name(&self) -> String {
        self.data.read().await.device_name.clone()
    }

    pub async fn set_device_name(&self, new_name: String) {
        let mut w = self.data.write().await;
        w.device_name = new_name;
        if let Ok(json) = serde_json::to_string_pretty(&*w) {
            let _ = fs::write(&self.config_path, json);
        }
    }
}
