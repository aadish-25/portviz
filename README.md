# Portviz  
**Cross-Platform Port & Process Manager for Developers**

Portviz is a developer-focused CLI tool for inspecting active network ports, identifying bound processes, monitoring service changes in real time, and safely terminating processes — all through a structured, consistent interface.

It eliminates the need for OS-specific commands like `netstat`, `lsof`, or `taskkill` during development and provides a unified workflow for managing ports across environments.

---

## 🚀 Vision

Portviz is being built in structured phases:

- ✅ Core port inspection engine (Python)
- ✅ Production-ready CLI with rich output and JSON streaming
- 🔄 Cross-platform abstraction (Windows → macOS/Linux expansion)
- 🔜 VS Code extension for in-editor visibility and control
- 🔜 Project-level service & port orchestration layer

The long-term goal is to evolve Portviz into a modular developer utility that integrates seamlessly into modern development workflows.

---

## 🎯 Problem It Solves

During development:

- Servers may crash but keep ports occupied  
- “Port already in use” errors interrupt workflow  
- Identifying and killing processes requires OS-specific commands  
- Managing multiple services across different ports becomes tedious  

Traditional commands:

- macOS/Linux → `lsof -i :3000` + `kill -9 <PID>`
- Windows → `netstat -ano` + `taskkill /PID <PID>`

Portviz abstracts these differences and provides a clean, consistent CLI interface.

---

## 📦 Current Features (v1.0.0)

### 🔎 Port Inspection
- Full port report
- Summarized port statistics
- LISTEN-only filtering
- Public vs local-only port detection
- Dual-stack (IPv4 + IPv6) detection
- Per-port inspection

### 🧠 Process Management
- Kill by PID
- Kill by port (auto-detect associated processes)
- Structured termination results
- Safe PID mapping

### 📸 Snapshot System
- Save current port state
- List saved snapshots
- Diff snapshots (detect new/closed services)

### 👀 Real-Time Monitoring
- Live dashboard mode (Rich-based UI)
- Stream mode for lightweight monitoring
- NDJSON streaming for automation pipelines
- Event-based service start/stop detection

### 🧾 JSON Support
All major commands support structured JSON output for:
- Automation
- Logging
- External integrations
- Tool chaining

---

## 🏗 Architecture Overview

Portviz follows a layered, modular architecture:

### 1️⃣ Core Engine
- OS detection
- System command execution
- Raw output parsing
- Structured data normalization
- Port summary generation
- Safe process termination

### 2️⃣ CLI Layer
- Argparse-based command routing
- Rich-formatted dashboard
- JSON output layer
- Snapshot management
- Watch/event streaming

### 3️⃣ Storage Layer
- Snapshot persistence via `platformdirs`
- OS-specific user data directories
- Structured snapshot diffing

This separation ensures the core engine remains reusable for IDE extensions or external tooling.

---

## 🧠 How It Works

1. Detect operating system
2. Execute appropriate networking command:
   - Windows → `netstat -ano`
   - macOS/Linux → `lsof -i -P -n` (planned full support)
3. Capture raw output
4. Parse into structured objects:
   - Protocol
   - Local IP
   - Local Port
   - Foreign IP
   - State
   - PID
   - Process name
5. Normalize into internal models
6. Provide CLI, snapshot, or streaming output
7. Allow safe termination via PID mapping

---

## 🖥 Example Usage

```bash
portviz
portviz report
portviz report --json
portviz summary
portviz list --public
portviz port 3000
portviz kill --port 3000
portviz snapshot save
portviz snapshot diff
portviz watch
portviz watch --stream --json
```

---

## 🧩 Project Structure

```
portviz/
│
├── pyproject.toml
├── README.md
└── portviz/
    ├── actions/
    ├── cli/
    ├── collectors/
    ├── core/
    ├── storage/
    ├── version.py
    ├── __main__.py
    └── services.py
```

The project uses modern Python packaging (`pyproject.toml`) and publishes via PyPI.

---

## 🔮 Future Enhancements

### 🔄 Full Cross-Platform Engine
- macOS & Linux parity
- Unified abstraction layer
- Command normalization improvements

### 🧩 Project-Level Service Management
- Workspace-based service configuration
- Define:
  - Service name
  - Port
  - Start command
  - Dependencies
  - Service type
- One-click startup of all services
- Conflict detection
- Health monitoring

### 🗺 Service Topology Visualization
- Visual frontend–backend–database representation
- Live service status indicators
- Architecture overview inside VS Code

### ⚙ Developer Experience Improvements
- Interactive CLI mode
- Smart port conflict suggestions
- Docker container awareness
- Permission safety checks
- Performance optimizations
- Configurable watch intervals
- Event schema versioning

---

## 🧠 Long-Term Scope

- PyPI distribution (completed)
- npm wrapper for JavaScript ecosystem
- VS Code Marketplace extension
- Project-level service orchestration
- Local development architecture visualization
- Developer workflow automation toolkit

---

## 🔧 Tech Stack

- Python 3.9+
- Rich (terminal UI)
- Pyfiglet (CLI banner)
- Platformdirs (OS-specific storage)
- Subprocess-based system command execution
- Structured CLI architecture

---

## 📌 Status

Stable v1.0.0 release.

Core CLI engine is production-ready.  
Cross-platform expansion and IDE integration are planned next phases.

---

## 📄 License

MIT License.

