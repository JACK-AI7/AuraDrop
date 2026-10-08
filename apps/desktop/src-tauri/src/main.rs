// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;

pub fn log_debug(msg: &str) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("C:\\Users\\bjasw\\Downloads\\AuraDrop-Windows\\debug.log")
    {
        let _ = writeln!(f, "[{}] {}", chrono::Local::now().format("%H:%M:%S%.3f"), msg);
    }
}

fn main() {
    log_debug("=== AuraDrop main() started ===");

    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC: {:?}\n", info);
        log_debug(&msg);
        let _ = std::fs::write("C:\\Users\\bjasw\\Downloads\\AuraDrop-Windows\\crash.log", &msg);
        eprintln!("{}", msg);
    }));

    auradrop_lib::run();
    log_debug("=== AuraDrop main() exited ===");
}
