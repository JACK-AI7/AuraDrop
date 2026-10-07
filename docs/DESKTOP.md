# AuraDrop Desktop Web Client Architecture

The AuraDrop Desktop client is a high-performance React + TypeScript application (`apps/web`) hosted on Vercel.

---

## 1. Directory Structure

```
apps/web/
├── src/
│   ├── engine/
│   │   ├── signalingClient.ts         # Production WebSocket client (with cloud fallback)
│   │   ├── transferEngine.ts          # WebRTC peer connection & state machine
│   │   ├── chunkStreamer.ts           # 64 KB chunk slicer & backpressure monitor
│   │   └── transferStorage.ts         # LocalStorage & IndexedDB persistent history
│   ├── components/
│   │   ├── HeroGlobe.tsx              # Three.js 3D radar peer discovery visualization
│   │   ├── FloatingSideRail.tsx       # Minimalist 5-dot floating navigation rail
│   │   ├── AirDropNotification.tsx    # Heads-up incoming transfer notification modal
│   │   ├── DockedShareTray.tsx        # File drag-and-drop & send tray
│   │   ├── DiagnosticsView.tsx        # Realtime WebSocket & WebRTC health inspector
│   │   └── Modals.tsx                 # Account, settings, and profile modals
│   ├── App.tsx                        # Main UI layout & state orchestration
│   └── main.tsx                       # React DOM entry point
├── package.json
└── vite.config.ts
```

---

## 2. File Streaming & Native File System API

### 2.1 File Slicing without RAM Buffering
```typescript
class ChunkStreamer {
  async streamFile(file: File, onChunk: (data: Uint8Array) => Promise<void>) {
    const CHUNK_SIZE = 64 * 1024;
    let offset = 0;

    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      await onChunk(new Uint8Array(buffer));
      offset += CHUNK_SIZE;
    }
  }
}
```

### 2.2 File System Access API
In modern Chromium browsers, incoming files can be written directly to the host filesystem using `window.showSaveFilePicker()` and `FileSystemWritableFileStream`, completely bypassing browser memory limits.

---

## 3. Deployment on Vercel

```bash
cd apps/web
pnpm build
vercel --prod
```

### Environment Configuration:
- `VITE_SIGNALING_URL`: `wss://api.auradrop.network`
- `VITE_BACKEND_URL`: `https://api.auradrop.network`
