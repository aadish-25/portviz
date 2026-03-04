# 🔌 Portviz

**Modern Port & Process Inspector for Developers — CLI + VS Code Extension**

Portviz is a developer-focused tool for inspecting active network ports, identifying bound processes, monitoring service changes in real time, and safely terminating processes. Available as both a **Python CLI** and a fully-featured **VS Code extension** with a rich interactive dashboard.

It eliminates the need for OS-specific commands like `netstat`, `lsof`, or `taskkill` and provides a unified workflow for managing ports — whether from the terminal or directly inside your editor.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)

---

## 🚀 Vision

Portviz is being built in structured phases:

- ✅ **Core port inspection engine** (Python)
- ✅ **Production-ready CLI** with rich output and JSON streaming
- ✅ **VS Code extension** with interactive dashboard, snapshots, orchestration, and live monitoring
- 🔄 **Cross-platform abstraction** (Windows → macOS/Linux expansion)
- 🔜 **Project-level orchestration** and service topology visualization

The long-term goal is to evolve Portviz into a modular developer utility that integrates seamlessly into modern development workflows.

---

## 🎯 Problem It Solves

During development, port conflicts are a constant frustration:

- 🔴 **"Port already in use"** errors interrupt your workflow
- 🔍 **Finding the culprit** requires memorizing OS-specific commands
- 💀 **Killing processes** safely demands careful PID lookups
- 🔄 **Managing multiple services** across different ports is tedious

### Traditional Approach

| Platform        | Find Process                    | Kill Process             |
| --------------- | ------------------------------- | ------------------------ |
| **macOS/Linux** | `lsof -i :3000`                 | `kill -9 <PID>`          |
| **Windows**     | `netstat -ano \| findstr :3000` | `taskkill /PID <PID> /F` |

### The Portviz Way

```bash
portviz port 3000          # Find what's using port 3000
portviz kill --port 3000   # Kill it with one command
portviz watch              # Monitor all services in real-time
```

Or just open the **Portviz sidebar in VS Code** — see everything at a glance, kill processes with a click, and manage your entire service stack visually.

---

## 📦 Installation

### CLI — Via pip (Recommended)

```bash
pip install portviz
```

### CLI — From Source

```bash
git clone https://github.com/aadish-25/portviz.git
cd portviz
pip install -e .
```

### VS Code Extension

The extension is bundled in the `vscode-extension/` directory. To install locally:

```bash
cd vscode-extension
npm install
npm run build
npx @vscode/vsce package
```

Then install the generated `.vsix` file in VS Code via **Extensions → Install from VSIX**.

### Verify CLI Installation

```bash
portviz --version
```

---

## ✨ Current Features (v1.0.1)

### 🔎 Port Inspection (CLI)

- Full port report with detailed information
- Summarized port statistics
- LISTEN-only filtering
- Public vs local-only port detection
- Dual-stack (IPv4 + IPv6) detection
- Per-port inspection and analysis

### 🧠 Process Management (CLI + Extension)

- Kill by PID with safety checks
- Kill by port (auto-detect associated processes)
- Structured termination results
- Safe PID mapping and verification
- Auto-restart detection for Windows services

### 📸 Snapshot System (CLI + Extension)

- Save current port state to disk
- List all saved snapshots with metadata
- Diff snapshots to detect changes (new/closed services)
- Track service changes between snapshots
- Compare any two snapshots or snapshot vs live state (Extension)
- Rename and delete snapshots (Extension)
- Grouped diff view by process (Extension)
- Configurable max snapshot limit (Extension)

### 👀 Real-Time Monitoring (CLI + Extension)

- Live dashboard mode with Rich-based UI (CLI)
- Stream mode for lightweight monitoring (CLI)
- NDJSON streaming for automation pipelines (CLI)
- Event-based service start/stop detection
- Auto-refresh with configurable interval (Extension)
- Live CPU and memory usage per process (Extension)
- Highlight animation on newly-appeared PIDs (Extension)

### 🧾 JSON Support (CLI)

All major CLI commands support structured JSON output for:

- Automation and scripting
- Logging and auditing
- External integrations
- Tool chaining and pipelines

### 🔌 VS Code Extension

A fully-featured extension with a four-tab interactive dashboard:

#### 📊 Overview Tab

- Summary cards: listening ports, public ports, process count, UDP ports
- Risk insight section showing publicly-exposed services ranked by severity
- Last-updated timestamp

#### 🔴 Live Tab

- Expandable process list with PID, port count, and live CPU/memory badges
- Per-port details: protocol, bind address, public/local badge
- Auto-detected framework hints (~40 frameworks by process name, ~15 by port)
- Filter controls: hide system processes, public-only, show UDP
- Sort by name, PID, or port count
- One-click kill with confirmation dialog
- Open in browser for TCP ports

#### 📸 Snapshots Tab

- Save, rename, and delete named snapshots
- Compare any two snapshots with grouped diff view
- Compare snapshot vs current live state
- Swap compare selections

#### ⚙️ Orchestration Tab

- **Auto-detect** running services by matching ports/processes against known patterns
- **Create/edit/duplicate/delete** service definitions with:
  - Service name, role, port, working directory
  - Start commands and environment variables
  - Group/stack assignment
- **Start/stop services** via integrated VS Code terminals
- **Service stacks** — group related services, bulk start, ungroup, or delete
- Status tracking: running / starting / stopped / error
- Timeout detection for service startup
- Free-text search/filter across services

#### 🔔 Notifications

- Port opened / port closed toast alerts (configurable)
- Public port (`0.0.0.0`) exposure warnings (on by default)
- Watch list: get alerts when specific ports go up or down
- Service start timeout errors
- Kill result confirmations

#### ⚙️ Configuration Options

| Setting                                   | Default | Description                                |
| ----------------------------------------- | ------- | ------------------------------------------ |
| `portviz.autoRefreshInterval`             | `5s`    | Live tab auto-refresh interval             |
| `portviz.cliTimeout`                      | `15s`   | CLI call timeout                           |
| `portviz.serviceStartTimeout`             | `30s`   | Max wait for service to appear on its port |
| `portviz.maxSnapshots`                    | `15`    | Maximum saved snapshots                    |
| `portviz.notifications.portOpened`        | `false` | Toast when a new port starts listening     |
| `portviz.notifications.portClosed`        | `false` | Toast when a port stops listening          |
| `portviz.notifications.publicPort`        | `true`  | Warning when a port binds to `0.0.0.0`     |
| `portviz.resourceMonitor.enabled`         | `true`  | Enable per-process CPU/memory polling      |
| `portviz.resourceMonitor.refreshInterval` | `10s`   | Resource monitor poll interval             |

---

## 🏗️ Architecture Overview

Portviz follows a layered, modular architecture designed for extensibility:

### 1️⃣ **Core Engine** (Python)

- OS detection and platform abstraction
- System command execution (`netstat -ano`)
- Raw output parsing and structured data normalization
- Port summary generation
- Safe process termination

### 2️⃣ **CLI Layer** (Python)

- Argparse-based command routing
- Rich-formatted terminal dashboard
- JSON output serialization
- Snapshot management commands
- Watch/event streaming modes

### 3️⃣ **Storage Layer** (Python)

- Snapshot persistence via `platformdirs`
- OS-specific user data directories
- Structured snapshot diffing

### 4️⃣ **VS Code Extension** (TypeScript)

- Webview-based dashboard with four tabs
- CLI integration via child process spawning
- Service orchestration with terminal management
- Resource monitoring (CPU/memory per PID)
- Notification system with change detection
- Snapshot management with visual diffs

This separation ensures the core engine is reusable across both CLI and IDE contexts.

---

## 🧠 How It Works

1. **Detect operating system** (Windows, macOS, Linux)
2. **Execute appropriate networking command:**
   - Windows → `netstat -ano`
   - macOS/Linux → `lsof -i -P -n` _(planned)_
3. **Capture and parse raw output**
4. **Structure into typed objects:**
   - Protocol (TCP/UDP)
   - Local IP and Port
   - Foreign IP and Port
   - Connection State
   - Process ID (PID)
   - Process Name
5. **Normalize into internal models**
6. **Provide CLI, snapshot, or streaming output**
7. **Allow safe termination via PID mapping**

The VS Code extension calls the CLI with `--json` and renders the structured data in the webview dashboard.

---

## 🖥️ Usage Examples

### CLI — Basic Commands

```bash
# Show full port report
portviz report

# Get JSON output for automation
portviz report --json

# View port summary statistics
portviz summary

# List only listening ports
portviz list

# Show public (externally accessible) ports
portviz list --public

# Show local-only listening ports
portviz list --local

# Inspect a specific port
portviz port 3000

# Kill process by PID
portviz kill --pid 12345

# Kill all processes using port 3000
portviz kill --port 3000
```

### CLI — Snapshot Management

```bash
# Save current port state
portviz snapshot save

# List all snapshots
portviz snapshot list

# Diff last two snapshots (detect changes)
portviz snapshot diff

# Diff specific snapshots
portviz snapshot diff snapshot1.json snapshot2.json
```

### CLI — Real-Time Monitoring

```bash
# Watch ports in live dashboard mode
portviz watch

# Stream port events (lightweight)
portviz watch --stream

# Stream events in JSON format
portviz watch --stream --json
```

### VS Code Extension

1. Open the **Portviz** sidebar from the Activity Bar
2. Browse running ports in the **Live** tab
3. Click any process to expand port details
4. Use the **Kill** button to terminate processes
5. Save snapshots and compare them in the **Snapshots** tab
6. Define and manage services in the **Orchestration** tab
7. Check the **Overview** tab for risk insights on public-facing ports

---

## 🧩 Project Structure

```
portviz/
│
├── pyproject.toml              # Python project config
├── README.md
├── LICENSE
│
├── portviz/                    # Python CLI package
│   ├── __init__.py
│   ├── __main__.py             # Entry point
│   ├── version.py              # Version management
│   ├── services.py             # Data collection orchestration
│   │
│   ├── actions/                # Process actions (kill, etc.)
│   │   └── process.py
│   │
│   ├── cli/                    # Command-line interface
│   │   ├── commands.py         # Command handlers
│   │   ├── parser.py           # Argument parsing
│   │   ├── formatter.py        # Rich output formatting
│   │   └── json_utils.py       # JSON serialization
│   │
│   ├── collectors/             # OS-specific data collectors
│   │   └── windows.py          # Windows netstat parser
│   │
│   ├── core/                   # Core domain logic
│   │   ├── models.py           # Data models (PortEntry, etc.)
│   │   ├── processors.py       # Data filtering & analysis
│   │   └── summary.py          # Summary generation
│   │
│   └── storage/                # Persistence layer
│       └── snapshot.py         # Snapshot save/load/diff
│
└── vscode-extension/           # VS Code extension
    ├── package.json            # Extension manifest & config
    ├── tsconfig.json
    ├── esbuild.js              # Build configuration
    │
    ├── src/
    │   ├── extension.ts        # Extension entry point
    │   │
    │   ├── views/
    │   │   └── dashboardViewProvider.ts   # Webview dashboard (4 tabs)
    │   │
    │   ├── services/
    │   │   ├── cliRunner.ts               # CLI child process integration
    │   │   ├── snapshotService.ts          # Snapshot CRUD & diffing
    │   │   ├── orchestrationService.ts     # Service management & terminals
    │   │   ├── notificationService.ts      # Port change notifications
    │   │   └── resourceMonitor.ts          # CPU/memory monitoring
    │   │
    │   └── types/
    │       ├── report.ts                   # Port data types
    │       ├── snapshot.ts                 # Snapshot types
    │       └── orchestration.ts            # Service orchestration types
    │
    └── media/
        ├── main.js             # Webview frontend logic
        └── styles.css          # Dashboard styling
```

---

## 🔮 Future Enhancements

### 🌍 Cross-Platform Expansion

- **Full macOS support** with `lsof` integration
- **Linux support** for major distributions
- **Unified abstraction layer** across all platforms
- **Platform-specific optimizations** and command normalization

### 🗺️ Service Topology Visualization

- **Visual architecture map** showing frontend ↔ backend ↔ database flows
- **Live status indicators** (running/stopped/error) on the graph
- **Interactive service graph** with clickable nodes
- **Export architecture diagrams** for documentation

### ⚙️ Developer Experience Improvements

- **Interactive CLI mode** with autocomplete
- **Smart port conflict suggestions** ("Port 3000 in use, try 3001?")
- **Docker container awareness** and integration
- **Permission safety checks** before killing processes
- **Performance optimizations** for large port lists
- **Custom output templates** for reporting
- **Plugin system** for extensibility
- **Watch mode filters** (by port range, process name, etc.)

### 🛡️ Advanced Features

- **Process tree visualization** (parent/child relationships)
- **Historical port usage analytics**
- **Alert rules** for suspicious port activity
- **Export to various formats** (CSV, XML, HTML reports)
- **Network traffic statistics** per port
- **Automated port cleanup** on service exit
- **Snapshot import/export** for sharing configs across teams

### 🌐 Ecosystem Integration

- **CI/CD pipeline integration** for port conflict detection
- **Docker Compose compatibility** for container port mapping
- **Kubernetes port forwarding** management
- **npm wrapper** for JavaScript ecosystem
- **REST API** for remote control
- **Web dashboard** for team visibility

### 🔌 VS Code Extension — Next Steps

- **VS Code Marketplace publication**
- **Multi-select and batch operations** on individual services
- **Export/import** for snapshots and orchestration configs
- **Automated testing** and CI/CD for the extension
- **Status bar integration** with quick actions
- **Keyboard shortcuts** for common operations

---

## 🔧 Tech Stack

### CLI

- **Python 3.9+** — Core engine
- **Rich** — Beautiful terminal UI and live dashboards
- **Pyfiglet** — ASCII art banners
- **Platformdirs** — Cross-platform storage paths
- **Subprocess** — System command execution

### VS Code Extension

- **TypeScript** — Extension logic and services
- **VS Code Webview API** — Interactive dashboard UI
- **esbuild** — Fast bundling
- **HTML/CSS/JS** — Webview frontend with accessibility support

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit your changes** (`git commit -m 'Add amazing feature'`)
4. **Push to the branch** (`git push origin feature/amazing-feature`)
5. **Open a Pull Request**

### Areas for Contribution

- macOS and Linux platform support
- VS Code extension testing and improvements
- Documentation and examples
- Bug fixes and performance optimizations

---

## 📌 Project Status

**Current Version:** v1.0.1
**Status:** Stable — Production Ready

| Component             | Status                                |
| --------------------- | ------------------------------------- |
| **CLI Engine**        | ✅ Production ready                   |
| **VS Code Extension** | ✅ Feature complete (pre-marketplace) |
| **Windows Support**   | ✅ Full support                       |
| **macOS Support**     | 🔄 Planned                            |
| **Linux Support**     | 🔄 Planned                            |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) file for details.

Copyright (c) 2026 Aadish Sonawane

---

<div align="center">

**⭐ Star this repo if you find it useful!**

Made with ❤️ by [Aadish Sonawane](https://github.com/aadish-25)

</div>
