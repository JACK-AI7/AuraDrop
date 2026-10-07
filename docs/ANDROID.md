# AuraDrop Android Native Client Architecture

The AuraDrop Android client is built as a production-grade Flutter + Kotlin hybrid application (`apps/android`).

---

## 1. Directory Structure

```
apps/android/
├── lib/
│   ├── main.dart                      # Flutter app bootstrap & theme
│   ├── screens/
│   │   ├── home_screen.dart           # Radar device discovery screen
│   │   ├── history_screen.dart        # Real received/sent file history
│   │   └── settings_screen.dart       # Network & signaling diagnostics
│   └── services/
│       ├── aura_protocol.dart         # Bit-exact 20-byte P2PFS/1 wire protocol
│       ├── aura_signaling_service.dart# WebSocket connection to signaling cluster
│       ├── aura_webrtc_service.dart   # WebRTC engine & streaming disk writer
│       └── native_bridge.dart         # MethodChannel communication with Kotlin
└── android/app/src/main/kotlin/com/auradrop/auradrop/
    └── MainActivity.kt                # Foreground service, SAF URI copy, notifications
```

---

## 2. Key Components

### 2.1 Streaming Disk I/O (`AuraWebRtcService`)
- When a file transfer starts, `AuraWebRtcService` opens an `IOSink` directly targeting `/storage/emulated/0/Download/AuraDrop/filename.ext.part`.
- Incoming binary chunks (64 KB) are written directly to disk.
- Chunk bytes are piped into `crypto.sha256` incrementally.
- Upon completion, the final checksum is verified against the header checksum.
- On match, the `.part` suffix is atomically renamed to the complete filename.
- **Memory footprint:** Constant ~15 MB RAM even when receiving a 40 GB video file.

### 2.2 Background Persistence & Foreground Service (`MainActivity.kt`)
- Android aggressively terminates background tasks unless an active foreground service exists.
- `MainActivity.kt` implements `AuraForegroundService` with notification channel `auradrop_transfers`.
- During active transfers, an ongoing notification displays real bytes, percent, and transfer speed.
- `WAKE_LOCK` and `FOREGROUND_SERVICE_DATA_SYNC` permissions ensure transfers continue when the phone screen turns off.

### 2.3 Storage Access Framework (SAF) Resolution
- Android 11+ restricts raw file path access (`Scoped Storage`).
- When a user selects files using the system picker, Android returns content URIs (`content://...`).
- `MainActivity.kt:copyUriToCache` reads the content stream into cache storage so WebRTC chunk slicing can stream binary data reliably.

---

## 3. Building the Release APK

```bash
cd apps/android
flutter clean
flutter pub get
flutter build apk --release
```

Release artifact location:
`apps/android/build/app/outputs/flutter-apk/app-release.apk`
