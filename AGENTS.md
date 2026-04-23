# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

ADB Tool is a Wails v2 desktop GUI for Android Debug Bridge (ADB). It provides device management, app management, memory monitoring, file browsing, screenshots, developer tool toggles, and more. The UI is fully Chinese-localized. The project also includes "Aya", an on-device DEX server pushed to Android devices via ADB for enhanced capabilities (batch package info with icons) over a protobuf-based socket protocol.

## Build & Run Commands

```bash
# Development (hot-reload)
wails dev

# Production build
wails build

# Platform-specific build with version
wails build -clean -platform darwin/universal -ldflags "-X main.Version=$VERSION"

# Frontend only (inside frontend/)
npm install
npm run dev        # Vite dev server
npm run build      # tsc && vite build

# Aya server DEX (inside server/)
cd server && ./gradlew :server:assembleRelease   # outputs resources/aya.dex
```

There are no tests, linters, or formatters configured in this project.

## Architecture

### Wails Binding Pattern

Go `App` struct methods are bound to the frontend via Wails auto-generated bindings in `frontend/wailsjs/go/main/`. The frontend calls Go functions directly through these bindings.

**Action dispatch:** The frontend sends an `Action` struct (action name, target package, device serial) to `App.ExecuteAction()` in `app.go`, which routes via a switch statement to ADB command functions in `adb/adb_util.go`. Results are returned as `ExecResult{cmd, res, error}`.

**Events (backend→frontend push):** `runtime.EventsEmit()` pushes device list updates (`adb_update`) and app-list progress (`app-list-progress`) to the frontend.

### Key Backend Packages

- `adb/` — ADB command builders and device tracker. `adb_util.go` contains 40+ action implementations. `adb_device_tracker.go` runs `adb track-devices` for real-time device detection.
- `aya/` — Client for the on-device Aya server. Pushes DEX, starts via `app_process`, communicates over forwarded TCP sockets using protobuf (`aya/proto/wire.proto`).
- `storage/` — BadgerDB key-value store for persistent config (ADB path, bookmarks). Data stored at `~/$UserConfigDir/config/badger`.
- `types/` — Shared `ExecResult` struct.
- `util/` — Shell execution (`/bin/sh -c`), Android version mapping, string helpers.

### Key Frontend Structure

- **State:** Zustand stores in `frontend/src/store/` — `deviceStore.ts` (device state), `appListStore.ts` (app list with per-device caching).
- **Views:** `RootContainer.tsx` switches between 6 views via numeric keys: actions (`'1'`, RightContainer), FAQ (`'2'`), settings (`'3'`), app list (`'4'`, ApplicationList), memory monitor (`'5'`, MemoryMonitor), file manager (`'6'`, FileManager).
- **Actions:** `frontend/src/data/quickActions.ts` defines the `ActionType` union and ~48 quick actions across 5 sections (common, app, keys, quick settings, system).
- **UI:** React 18 + Ant Design v5 + Tailwind CSS v4 + Recharts (memory charts) + react-markdown (FAQ).

### Aya DEX Version Coupling

`AyaDexVersion` in `aya/client.go` **must match** `versionName` in `server/server/build.gradle`. A mismatch triggers a server restart on the device. When updating the Aya server, bump both values and `versionCode` in the Gradle file.

### Version Injection

`main.go` has a `Version` variable set via `-ldflags "-X main.Version=$VERSION"` at build time (defaults to `"dev"`).

### Embedded Resources

`main.go` embeds `frontend/dist` (compiled frontend) and `resources/aya.dex` (Aya server) using Go's `//go:embed`.

### CI/CD

GitHub Actions workflow (`.github/workflows/release.yml`) triggers on `v*` tags, builds for Linux/macOS/Windows in parallel, and creates a GitHub Release with all artifacts.
