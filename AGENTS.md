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

Go tests: `go test ./...`. Frontend type check: `cd frontend && npx tsc --noEmit`. There are no linters or formatters configured beyond `gofmt`.

## Architecture

### Wails Binding Pattern

Go `App` struct methods are bound to the frontend via Wails auto-generated bindings in `frontend/wailsjs/go/main/`. The frontend calls Go functions directly through these bindings.

**Action dispatch:** The frontend sends an `Action` struct (action name, target package, device serial) to `App.ExecuteAction()` in `app_actions.go`, which routes via a switch statement to functions in `internal/actions`. Results are returned as `ExecResult{cmd, res, error}`.

**Events (backend→frontend push):** `runtime.EventsEmit()` pushes device list updates (`adb_update`), app-list progress (`app-list-progress`), action stages (`action-stage`) and performance monitor data (`perf-sample`, `perf-memory`, `perf-event`, `perf-status`) to the frontend.

### Project Layout

The repository root holds only the Wails `main` package: `main.go` (entry point), `version.go`, and `app*.go`, which define the `App` methods bound to the frontend. These methods are thin forwarders grouped by feature (`app_actions.go`, `app_apps.go`, `app_files.go`, `app_perf.go`, `app_wireless.go`, `app_settings.go`, `app_logs.go`); the implementation lives in `internal/`.

### Key Backend Packages (`internal/`)

- `adb/` — Core: `ExecuteParams`, command building (`Command` / `ShellCommand`, which quote the adb path), `Exec`, package-name validation, device list, and `tracker.go` (`adb track-devices` for real-time device detection).
- `actions/` — Quick action implementations, one function per frontend action: `app.go` (activities, start/stop/clear, permissions, packages, export, uninstall), `device.go` (device info, screenshot, keys, settings pages, developer toggles), `dump.go` (meminfo/smaps/showmap/threads/hprof), `install.go` (APK install with downgrade confirmation), `tools.go` (screenshot to clipboard, Deep Link), `save.go` (save dialogs).
- `perf/` — Performance monitor (`monitor.go` sampling loops, `events.go` process start/death/restart via pid + start time, logcat events and exit-info, `parse.go` /proc parsing), thread scheduling (`threadsched.go`) and `dumpsys meminfo` parsing (`meminfo.go`).
- `wireless/` — Wireless debugging: QR / pairing-code pairing, connect, USB to wireless (`adb tcpip`), mDNS discovery.
- `files/` — Device file manager (list, preview, upload, download, delete).
- `update/` — Checks GitHub Releases for a newer version.
- `aya/` — Client for the on-device Aya server. Pushes DEX, starts via `app_process`, communicates over forwarded TCP sockets using protobuf (`internal/aya/proto/wire.proto`).
- `storage/` — BadgerDB key-value store for persistent config (ADB path, bookmarks). Data stored at `~/$UserConfigDir/config/badger`.
- `applog/` — Rotating app log files shown in the diagnostic log page.
- `types/` — Shared `ExecResult` struct.
- `util/` — Host command execution (`/bin/sh -c`, `cmd /S /C` on Windows) and `QuoteHostArg`, Android version mapping, string helpers.

Commands that pass device-side paths should run adb with an argument list (see `adb.ExecuteParams.Args`) instead of a shell string, so paths with spaces survive.

### Key Frontend Structure

- **State:** Zustand stores in `frontend/src/store/` — `deviceStore.ts` (device state), `appListStore.ts` (app list with per-device caching and background preload), `packageListStore.ts` (installed packages and quick-action target app), `perfMonitorStore.ts` (performance monitor data), `themeStore.ts` (light/dark).
- **Views:** `RootContainer.tsx` switches between 7 views via numeric keys: actions (`'1'`, `RightContainer`), FAQ (`'2'`, `FAQContainer`), settings (`'3'`, `SettingsContainer`), app list (`'4'`, `ApplicationList`), performance monitor (`'5'`, `PerfMonitor`), file manager (`'6'`, `FileManager`), diagnostic logs (`'7'`, `LogViewer`).
- **Actions:** `frontend/src/data/quickActions.ts` defines the `ActionType` union and ~48 quick actions across 5 sections (common, app, keys, quick settings, system).
- **UI:** React 18 + Ant Design v5 + Tailwind CSS v4 + Recharts (performance charts) + react-markdown (FAQ).

### Frontend Stack Requirement

- Prefer **Tailwind CSS** for layout, spacing, typography, color, and most component styling.
- Prefer **Ant Design** for mature interactive components and complex widgets such as `Table`, `Modal`, `Drawer`, `Form`, `Select`, `Switch`, `Tooltip`, and feedback components.
- New frontend work should follow the existing `Tailwind CSS + Ant Design` combination rather than introducing another UI framework or large custom styling system.
- When adjusting UI, keep visual consistency with the existing Ant Design behaviors while using Tailwind utility classes for page composition and local styling.

### UI Design Requirements

- **Read [DESIGN.md](DESIGN.md) before creating or changing any UI**, including pages, dialogs, drawers, and shared components. It is the source of truth for the project's visual design.
- Follow its color, typography, spacing, radius, border, and elevation tokens. Apply the app-control guidance (such as 6px button corners), and use its semantic error/warning colors for destructive actions and cautions.
- Implement the design with the existing **Tailwind CSS + Ant Design** stack. Ant Design defaults are not a substitute for the design specification; use local theme tokens and Tailwind utilities to align the affected components.
- Verify the rendered result against `DESIGN.md`, including text hierarchy, interaction states, and narrow-window layout. Preserve accessible focus and existing confirmation behavior.

### Aya DEX Version Coupling

`AyaDexVersion` in `internal/aya/client.go` **must match** `versionName` in `server/server/build.gradle`. A mismatch triggers a server restart on the device. When updating the Aya server, bump both values and `versionCode` in the Gradle file.

### Version Injection

`main.go` has a `Version` variable set via `-ldflags "-X main.Version=$VERSION"` at build time (defaults to `"dev"`).

### Embedded Resources

`main.go` embeds `frontend/dist` (compiled frontend) and `resources/aya.dex` (Aya server) using Go's `//go:embed`.

### CI/CD

GitHub Actions workflow (`.github/workflows/release.yml`) triggers on `v*` tags, builds for Linux/macOS/Windows in parallel, and creates a GitHub Release with all artifacts.
