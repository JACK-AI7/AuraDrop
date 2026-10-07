# AuraDrop Physical Cross-Device Testing Procedure

This procedure verifies physical peer-to-peer file transfer between a Windows Desktop PC and a physical Android smartphone connected to the same local Wi-Fi or across different networks via coturn TURN.

---

## 1. Prerequisites
1. **Desktop:** Windows PC running Node.js / Vite web client (`pnpm start:desktop` or deployed on Vercel).
2. **Android Phone:** Physical Android device with `apps/android/build/app/outputs/flutter-apk/app-release.apk` installed.
3. **Network:** Both devices connected to the same Wi-Fi network (e.g. `192.168.0.x`).

---

## 2. Step-by-Step Test Execution

### Step 1: Start Backend Signaling Gateway
On the Desktop PC terminal:
```bash
pnpm --filter @auradrop/backend start
```
Notice the reported LAN IP (e.g. `192.168.0.21:48280`).

### Step 2: Open Desktop Web App
Open Google Chrome or Microsoft Edge to:
`http://localhost:5173` or your Vercel URL.
In the top right Diagnostics or Settings, ensure the Signaling URL points to:
`ws://192.168.0.21:48280`

### Step 3: Launch Android Native App
1. Open the AuraDrop app on your Android smartphone.
2. In the bottom bar, tap **Settings**.
3. Under **Signaling Gateway**, ensure the IP is set to `192.168.0.21:48280`.
4. Tap **Connect**.
5. Return to the **Radar** screen.

### Step 4: Verify Bidirectional Discovery
- Within 1–3 seconds:
  - On Desktop screen: A new device card appears labeled with your Android Phone model.
  - On Android phone screen: A radar pulse displays your Desktop PC.

### Step 5: Transfer a Real File
1. On Desktop: Drag and drop a real file (e.g., a 100 MB video or PDF) onto the Android peer card.
2. Click **Send File**.
3. On Android phone: A heads-up incoming transfer notification appears showing:
   - Real filename.
   - Exact byte size.
   - Accept / Decline buttons.
4. Tap **Accept**.

### Step 6: Verify Streaming & Checksum Match
1. Watch the real-time progress bar and speed meter advance on both devices as 64 KB chunks stream directly over the local WebRTC DataChannel.
2. When the transfer reaches 100%, observe the incremental SHA-256 verification pass.
3. Open the Android file manager / Downloads folder and tap the received file to play or view it.
4. Verify the transfer is listed in History on both sides.
