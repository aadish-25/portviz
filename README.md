# 🔌 Portviz

**Modern Port & Process Inspector for Developers**

Stop wrestling with `netstat` and `taskkill`. Portviz gives you a clean CLI and VS Code extension to inspect ports, kill processes, and manage your development services.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)

## Why Portviz?

**Before:** `netstat -ano | findstr :3000` → find PID → `taskkill /PID 1234 /F`  
**After:** `portviz kill --port 3000`

- 🔍 **Find what's using any port** instantly
- 💀 **Kill processes** by port or PID safely
- 📸 **Save snapshots** and compare port states
- 👀 **Live monitoring** with real-time updates
- 🎛️ **VS Code integration** with visual dashboard

## 📦 Installation

### CLI

```bash
pip install portviz
```

### VS Code Extension

1. Open VS Code
2. Go to Extensions tab (Ctrl+Shift+X)
3. Search for "Portviz"
4. Click Install

_Or install manually: Download `portviz-1.0.8.vsix` from releases and use Extensions → Install from VSIX_

## 🚀 Quick Start

### CLI Commands

```bash
# See all active ports
portviz report

# Find what's using port 3000
portviz port 3000

# Kill process on port 3000
portviz kill --port 3000

# Save current state
portviz snapshot save

# Watch ports in real-time
portviz watch
```

### VS Code Extension

1. Open Portviz from the sidebar
2. **Live Tab**: See all running processes and ports
3. **Snapshots Tab**: Save and compare port states
4. **Orchestration Tab**: Manage your development services
5. **Overview Tab**: Get insights on public-facing ports

## ✨ Key Features

**CLI:**

- 🔍 Port inspection and process identification
- 💀 Safe process termination by port or PID
- 📸 Snapshot system with diff comparison
- 👀 Real-time monitoring and streaming
- 🧾 JSON output for automation

**VS Code Extension:**

- 📊 **Overview**: Summary cards and security insights
- 🔴 **Live**: Interactive process list with kill buttons
- 📸 **Snapshots**: Save, compare, and manage port states
- ⚙️ **Orchestration**: Define and manage development services
- 🔔 **Notifications**: Port change alerts and warnings
- 📈 **Resource Monitor**: Live CPU/memory usage per process

## 🧩 Project Structure

```
portviz/
├── portviz/                    # Python CLI package
│   ├── cli/                    # Command-line interface
│   ├── collectors/             # OS-specific data collectors
│   ├── core/                   # Core domain logic
│   ├── actions/                # Process actions
│   └── storage/                # Snapshot persistence
│
└── vscode-extension/           # VS Code extension
    ├── src/
    │   ├── views/              # Dashboard webview
    │   ├── services/           # CLI integration & orchestration
    │   └── types/              # TypeScript definitions
    └── media/                  # Icons and assets
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License — see [LICENSE](LICENSE) file for details.

---

<div align="center">

**⭐ Star this repo if you find it useful!**

Made with ❤️ by [Aadish Sonawane](https://github.com/aadish-25)

</div>
