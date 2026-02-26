# Portviz  
**Cross-Platform Port & Process Manager for Developers**

Portviz is a developer-focused utility designed to inspect active network ports, identify the processes bound to them, and safely terminate processes without relying on complex system commands.

It simplifies debugging scenarios like “Address already in use” errors by providing structured, readable port information and streamlined process control.

---

## 🚀 Vision

Portviz is being built in structured phases:

- Core cross-platform port inspection engine (Python)
- CLI utility for fast terminal usage
- VS Code extension for in-editor visibility and control
- Project-level service and port orchestration layer

The long-term goal is to create a modular developer utility that integrates seamlessly into modern development workflows.

---

## 🎯 Problem It Solves

During development:

- Servers may crash but keep ports occupied
- “Port already in use” errors interrupt workflow
- Identifying and killing processes requires OS-specific commands
- Managing multiple services across different ports becomes difficult

Examples:

- macOS/Linux → `lsof -i :3000` + `kill -9 <PID>`
- Windows → `netstat -ano` + `taskkill /PID <PID>`

Portviz abstracts these differences and provides a consistent interface.

---

## 🏗 Architecture Overview

Portviz follows a layered architecture:

### 1️⃣ Core Engine (Python)
- Detects operating system
- Executes system networking commands
- Parses raw command output
- Normalizes port data into structured objects
- Handles safe process termination

### 2️⃣ CLI Layer
- Displays structured port table
- Assigns custom IDs for safe termination
- Simplifies kill operations
- Supports filtered views (e.g., LISTEN state)

### 3️⃣ VS Code Extension (Planned)
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

## 📦 Features

- Cross-platform port inspection
- LISTEN port filtering
- PID-based safe termination
- Structured port object normalization
- OS abstraction layer
- Modular reusable core engine

---

## 🔮 Future Enhancements

### Project-Level Service Management
- Workspace-based service configuration
- Define service name, port, start command, dependencies, and type
- One-click startup of all project services
- Real-time service health monitoring
- Port conflict detection

### Service Topology Visualization
- Visual representation of frontend–backend–database architecture
- Live service status indicators
- Traffic flow tracking (where possible)

### Developer Experience Improvements
- Interactive CLI mode
- Auto-refresh/watch mode
- Docker container awareness
- IPv4/IPv6 normalization
- Permission safety checks
- Performance optimizations

---

## 🧩 Example Future Configuration (Conceptual)

Portviz may support project-level configuration such as:

Frontend  
- Port: 5173  
- Command: `npm run dev`

Backend  
- Port: 8000  
- Command: `nodemon server.js`

Database  
- Port: 5432  
- External service (no start command)

This would allow Portviz to function as a lightweight local development orchestrator inside VS Code.

---

## 🔧 Tech Stack

- Python  
- OS-level Networking Utilities (`lsof`, `netstat`)  
- Subprocess-based Process Management  
- Cross-Platform OS Detection  
- CLI Architecture  
- VS Code Extension API (Planned)  
- Node.js Integration (Planned)  

---

## 📌 Project Status

Currently in active development.

Phase 1 focuses on building a robust, reusable port inspection engine.  
CLI and VS Code integration layers will be built on top of the core module.

---

## 📈 Long-Term Scope

- Publish as a pip package
- npm wrapper for JavaScript ecosystem
- VS Code Marketplace extension
- Project-level service orchestration
- Local architecture visualization
- Advanced developer workflow tooling

---

## 📄 License

This project is licensed under the MIT License.
