# PortViz  
**Cross-Platform Port & Process Manager for Developers**

PortViz is a developer-focused tool designed to inspect active network ports, identify the processes bound to them, and safely terminate processes without relying on complex system commands.

It simplifies debugging scenarios like “Address already in use” errors by providing structured, readable port information and streamlined process control.

---

## 🚀 Vision

PortViz is being built in structured phases:

- Core cross-platform port inspection engine (Python)
- CLI utility for fast terminal usage
- VSCode extension for in-editor visibility and control

The long-term goal is to create a modular developer utility that integrates seamlessly into modern development workflows.

---

## 🎯 Problem It Solves

During development:

- Servers may crash but keep ports occupied
- “Port already in use” errors interrupt workflow
- Identifying and killing processes requires OS-specific commands

Examples:

- macOS/Linux → `lsof -i :3000` + `kill -9 <PID>`
- Windows → `netstat -ano` + `taskkill /PID <PID>`

PortViz abstracts these differences and provides a consistent interface.

---

## 🏗 Architecture Overview

PortViz follows a layered architecture:

### Core Engine (Python)
- Detects operating system
- Executes system networking commands
- Parses raw command output
- Normalizes port data into structured objects
- Handles safe process termination

### CLI Layer (In Progress)
- Displays structured port table
- Assigns custom IDs for safe termination
- Simplifies kill operations

### VSCode Extension (Planned)
- Sidebar port viewer
- Refresh button
- One-click process termination
- IDE workflow integration

This modular design ensures the engine can be reused across CLI tools and IDE integrations.

---

## 🧠 How It Works

1. Detect OS (Windows/macOS/Linux)
2. Execute appropriate system command:
   - `lsof -i -P -n`
   - `netstat -ano`
3. Capture raw output
4. Parse into structured objects:
   - Port
   - PID
   - Process name
   - Protocol
   - Address
   - State
5. Return normalized data
6. Allow safe process termination via PID mapping

---

## 📦 Planned Features

- Cross-platform port inspection
- LISTEN port filtering
- Custom ID-based kill commands
- Interactive CLI mode
- Auto-refresh/watch mode
- VSCode sidebar integration
- Docker container awareness
- IPv4/IPv6 normalization
- Safe permission handling

---

## 🔧 Tech Stack

- Python  
- OS-level Networking Utilities (`lsof`, `netstat`)  
- Subprocess-based Process Management  
- Cross-Platform OS Detection  
- CLI Architecture (Planned)  
- VSCode Extension API (Planned)  
- Node.js Integration (Planned)  

---

## 📌 Project Status

Currently in active development.

Phase 1 focuses on building a robust, reusable port inspection engine.  
CLI and VSCode integration layers will be built on top of the core module.

---

## 📈 Future Scope

PortViz aims to evolve into a full developer productivity utility with:

- Published pip package
- npm wrapper
- VSCode Marketplace extension
- Performance optimizations
- Enhanced developer experience features