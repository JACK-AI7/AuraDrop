# Native Platform File Handling & Background Execution Specifications

This specification details native storage integration and background transfer execution across Android, iOS, and Desktop platforms for AuraDrop.

---

## 1. Native File Handling (Section 12)

### A. Android (Scoped Storage & MediaStore)

On Android 10+ (API level 29+), AuraDrop adheres to Scoped Storage architecture:

1. **Media Files (Images, Audio, Videos):**
   - Streamed to app-specific cache directory as `${filename}.part`.
   - Verified with SHA-256 integrity check.
   - Inserted into system `MediaStore.Images`, `MediaStore.Video`, or `MediaStore.Audio` using `ContentResolver`.
   - Accessible immediately in Google Photos / Gallery without manual file browsing.

2. **Documents & Arbitrary Files:**
   - Stored in the public `Environment.DIRECTORY_DOWNLOADS/AuraDrop/` folder via MediaStore downloads collection.
   - Storage Access Framework (SAF) used if user selects a custom SD card or external drive.

3. **Security Invariant:**
   - Remote filenames are sanitized via `sanitizeFilename()` before filesystem operations.
   - Hidden or executable extensions (`.dex`, `.apk`, `.so`) require explicit user confirmation before opening.

---

### B. iOS (Files App & Photos Library)

1. **Media Files:**
   - Streamed into `FileManager.default.temporaryDirectory`.
   - Verified via checksum.
   - Added to user's photo library via `PHPhotoLibrary.shared().performChanges` (requesting `PHAccessLevel.addOnly` permission to minimize privacy prompts).

2. **Documents & Archives:**
   - Stored in the app's `Documents/AuraDrop/` container with `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` enabled in `Info.plist`.
   - Exposed directly in Apple's **Files** app under "On My iPhone" → "AuraDrop".
   - `UIDocumentInteractionController` or `UIActivityViewController` invoked for quick sharing.

---

### C. Windows, macOS & Linux Desktop

1. **Download Directory:**
   - Defaults to `~/Downloads/AuraDrop/`.
   - User can reconfigure destination path in Settings.
2. **Atomic Write Guarantee:**
   - File written as `${name}.part`.
   - Checksum verified against sender manifest.
   - Renamed atomically to final destination path.

---

## 2. Background Transfer Execution (Section 13)

### Operating System Constraints & Honest Architecture

| Platform | Background Constraint | AuraDrop Behavior |
| :--- | :--- | :--- |
| **Android** | Background execution limits terminate normal threads within minutes. | Starts an ongoing **Foreground Service** with an active notification displaying real-time transfer progress, speed, and cancel button. Allows transfers to complete in background. |
| **iOS** | Background sockets are suspended by iOS within 30 seconds of app minimize unless background audio/VoIP entitlement is held (not applicable to file transfer). | If app is backgrounded during active transfer: saves verified chunk checkpoint, pauses stream, sends a local notification ("*Transfer paused. Return to AuraDrop to resume*"). Resumes automatically upon foregrounding. |
| **Desktop** | Unrestricted background execution. | Continues streaming in background or system tray until completed. |
