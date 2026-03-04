# 📋 Portviz — Repository Review Report

**Version Reviewed:** v1.0.2  
**Date:** 2026-03-04  
**Scope:** Full repository — Python CLI package + VS Code extension

---

## 📖 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Repository Overview](#repository-overview)
3. [Architecture Assessment](#architecture-assessment)
4. [Python CLI — Detailed Review](#python-cli--detailed-review)
5. [VS Code Extension — Detailed Review](#vs-code-extension--detailed-review)
6. [Security Findings](#security-findings)
7. [Testing & Quality](#testing--quality)
8. [Documentation Review](#documentation-review)
9. [Recommendations](#recommendations)
10. [Summary Table](#summary-table)

---

## Executive Summary

Portviz is a well-structured developer tool providing real-time port inspection and process management via both a Python CLI and a VS Code extension. The project demonstrates clean architectural separation between core logic, CLI presentation, and IDE integration.

### Strengths

- **Clean layered architecture** — Core engine, CLI, storage, and extension are well-separated
- **Consistent code style** — Python uses dataclasses idiomatically; TypeScript follows VS Code extension patterns
- **Feature-rich VS Code extension** — Four-tab dashboard with orchestration, snapshots, and live monitoring
- **Good README** — Comprehensive documentation with examples, architecture diagrams, and future roadmap
- **Appropriate dependencies** — Minimal, well-chosen libraries (Rich, platformdirs, pyfiglet)

### Key Concerns

- **No test suite** — Zero automated tests across the entire codebase
- **Windows-only** — Core collector is tightly coupled to `netstat -ano` and `taskkill`
- **Fragile parsing** — Netstat output parsing relies on hardcoded indices without validation
- **Missing input validation** — CLI and extension lack defensive checks on user inputs
- **Silent error suppression** — Several catch blocks swallow errors without logging

---

## Repository Overview

| Metric | Value |
|---|---|
| **Total Python LOC** | 1,008 lines (14 files) |
| **Total Extension LOC** | 5,534 lines (13 files) |
| **Total LOC** | ~6,542 lines |
| **Python Dependencies** | 3 (rich, platformdirs, pyfiglet) |
| **Node Dependencies** | 3 dev (@types/vscode, esbuild, typescript) |
| **Test Coverage** | 0% (no tests) |
| **License** | MIT |
| **Python Version** | 3.9+ |
| **VS Code Engine** | 1.80.0+ |

### File Distribution

```
Python CLI Package:
  portviz/__init__.py          1 line
  portviz/__main__.py         37 lines   — Entry point + banner
  portviz/version.py           1 line    — Version constant
  portviz/services.py         10 lines   — Data collection orchestration
  portviz/actions/process.py  18 lines   — Process termination
  portviz/cli/commands.py    403 lines   — Command handlers (largest file)
  portviz/cli/parser.py      125 lines   — Argument parsing
  portviz/cli/formatter.py    55 lines   — Rich output formatting
  portviz/cli/json_utils.py   20 lines   — JSON serialization
  portviz/collectors/windows.py 76 lines — Windows netstat parser
  portviz/core/models.py      29 lines   — Data models
  portviz/core/processors.py 109 lines   — Filtering & analysis
  portviz/core/summary.py     20 lines   — Summary generation
  portviz/storage/snapshot.py 104 lines  — Snapshot persistence

VS Code Extension:
  src/extension.ts                  51 lines   — Activation entry point
  src/views/dashboardViewProvider.ts 1,012 lines — Webview dashboard (largest)
  src/services/cliRunner.ts         79 lines   — CLI child process runner
  src/services/snapshotService.ts  168 lines   — Snapshot CRUD & diffing
  src/services/orchestrationService.ts 259 lines — Service management
  src/services/notificationService.ts  138 lines — Port change alerts
  src/services/resourceMonitor.ts  156 lines   — CPU/memory polling
  src/types/report.ts               11 lines   — Port data types
  src/types/snapshot.ts             46 lines   — Snapshot types
  src/types/orchestration.ts        77 lines   — Service types
  media/main.js                  1,613 lines   — Webview frontend logic
  media/styles.css               1,892 lines   — Dashboard styling
```

---

## Architecture Assessment

### Overall Architecture: ✅ Good

The project follows a clean layered design:

```
┌─────────────────────────────────┐
│    VS Code Extension (TS)       │  ← IDE integration layer
│  ┌──────────┐ ┌──────────────┐  │
│  │ Webview   │ │  Services    │  │
│  │ Dashboard │ │  (CLI Runner,│  │
│  │ (HTML/JS) │ │  Snapshots,  │  │
│  │           │ │  Orchestrate)│  │
│  └──────────┘ └──────┬───────┘  │
└──────────────────────┼──────────┘
                       │ JSON over stdin/stdout
┌──────────────────────┼──────────┐
│    Python CLI        │          │  ← Presentation layer
│  ┌─────────┐  ┌──────┴───────┐  │
│  │ Parser  │  │  Commands    │  │
│  │         │  │  (Rich/JSON) │  │
│  └─────────┘  └──────┬───────┘  │
│                      │          │
│  ┌───────────────────┴────────┐ │
│  │  Core Engine               │ │  ← Business logic layer
│  │  (Models, Processors,      │ │
│  │   Summary, Storage)        │ │
│  └───────────────────┬────────┘ │
│                      │          │
│  ┌───────────────────┴────────┐ │
│  │  Collectors (Windows)      │ │  ← Platform abstraction layer
│  │  (netstat, tasklist)       │ │
│  └────────────────────────────┘ │
└─────────────────────────────────┘
```

**Positive Observations:**
- Clear separation of concerns between layers
- Data models are simple dataclasses, easy to extend
- Extension communicates with CLI via JSON — clean integration boundary
- Services in the extension are individually testable

**Areas for Improvement:**
- `commands.py` at 403 lines handles all commands — should be split per command
- `dashboardViewProvider.ts` at 1,012 lines combines UI generation with business logic
- No dependency injection — tight coupling to concrete implementations
- `services.py` is a thin wrapper that adds little value (10 lines)

---

## Python CLI — Detailed Review

### `portviz/collectors/windows.py` — ⚠️ High Priority

This is the most fragile module in the project.

**Issues Found:**

1. **No error handling for subprocess calls** — If `netstat` or `tasklist` is unavailable or fails, the entire application crashes with an unhandled exception.

2. **Fragile line parsing** — The parser uses hardcoded index-based splitting:
   ```python
   parts = line.split()
   proto = parts[0]      # Could IndexError
   local = parts[1]      # Could IndexError
   foreign = parts[2]    # Could IndexError
   ```
   No length validation on `parts` before accessing indices.

3. **No validation on `rsplit` results** — Port extraction via `rsplit(":", 1)` assumes a colon exists. Non-standard output would cause `IndexError`.

4. **Process map lookup without fallback** — `process_map.get(pid)` returns `None` silently, creating entries with `None` process names.

5. **Windows-only with no platform guard** — The module calls `netstat -ano` and `tasklist` without checking `sys.platform`, meaning it will fail silently or crash on macOS/Linux.

### `portviz/cli/commands.py` — ⚠️ Medium Priority

**Issues Found:**

1. **No input validation on port numbers** — User can pass negative numbers or strings that are coerced to invalid values:
   ```python
   portviz port -1      # No validation
   portviz kill --port 0 # Edge case not handled
   ```

2. **Watch mode lacks error recovery** — The `while True` loop in watch/stream modes has no try/except around `collect_port_data()`. A single data collection failure terminates the entire watch session.

3. **Mixed output approaches** — Some commands print via Rich console, others via `print()`, and JSON mode uses `json.dumps()`. Inconsistent output channel usage.

4. **Snapshot diff with no snapshots** — `snapshot diff` with fewer than 2 snapshots prints an error but doesn't set exit codes.

### `portviz/actions/process.py` — ⚠️ Medium Priority

**Issues Found:**

1. **Broad exception handling** — Catches `Exception` generically:
   ```python
   except Exception as e:
       return KillResult(pid=pid, success=False, message=str(e))
   ```
   This masks the specific failure reason (permission denied, PID not found, etc.).

2. **No PID validation** — Integer PID is passed directly to `taskkill` without range validation (e.g., PID 0 or negative PIDs).

3. **Windows-only** — Uses `taskkill /F /PID` with no cross-platform fallback.

### `portviz/storage/snapshot.py` — ⚠️ Medium Priority

**Issues Found:**

1. **No file corruption handling** — `json.load()` on a corrupted snapshot file raises an unhandled `JSONDecodeError`.

2. **No path sanitization** — Snapshot filenames are constructed from timestamps, but `load_snapshot()` accepts arbitrary filenames, potentially enabling directory traversal if user-supplied names are ever passed.

3. **No atomic writes** — Snapshots are written directly to the target file. A crash mid-write corrupts the file permanently.

### `portviz/core/processors.py` — 🟡 Low Priority

**Issues Found:**

1. **Repeated iteration** — Multiple functions iterate the same list independently. A single pass could compute all metrics.

2. **IPv6 detection heuristic** — Uses `"[" in entry.local_ip` to detect IPv6, which is fragile for edge cases.

### `portviz/core/models.py` — ✅ Good

Clean dataclass definitions. No issues found.

### `portviz/cli/parser.py` — ✅ Good

Well-structured argparse configuration with appropriate help text.

### `portviz/cli/formatter.py` — ✅ Good

Clean Rich table formatting.

### `portviz/cli/json_utils.py` — ✅ Good

Simple and effective dataclass-to-dict conversion.

---

## VS Code Extension — Detailed Review

### `src/views/dashboardViewProvider.ts` — ⚠️ High Priority

At 1,012 lines, this is the largest and most complex file.

**Issues Found:**

1. **Oversized file** — Combines webview HTML generation, message handling, filtering, orchestration integration, and kill logic. Should be split into separate handler modules.

2. **Weak type safety** — Uses `(msg as any)` and `(p as any).frameworkHint` for type casting instead of proper type narrowing:
   ```typescript
   const port = (msg as any).port;  // Should use typed message interfaces
   ```

3. **No message validation** — Messages from the webview are not validated before processing. A malformed message could cause runtime errors.

4. **Inline HTML generation** — The `_getHtmlForWebview()` method contains large HTML template strings, making it hard to maintain.

### `src/services/resourceMonitor.ts` — ⚠️ Medium Priority

**Issues Found:**

1. **Runtime property mutation** — Uses `(this as any)[`_rawCpu_${pid}`]` to store CPU computation state, which bypasses TypeScript's type system:
   ```typescript
   (this as any)[`_rawCpu_${pid}`] = { kernel, user };
   ```
   Should use a typed `Map<number, CpuState>` instead.

2. **Silent error suppression** — Multiple `catch {}` blocks swallow errors without any logging:
   ```typescript
   } catch { }  // Error completely hidden
   ```

3. **Platform-specific code in one file** — Windows (PowerShell) and Unix (ps) implementations are interleaved with conditional branches, making the code hard to follow.

### `src/services/cliRunner.ts` — ✅ Good

Clean promise-based CLI execution with proper timeout handling.

### `src/services/snapshotService.ts` — 🟡 Low Priority

**Issues Found:**

1. **Complex diff algorithm** — The `compare()` method at ~90 lines implements a full diff algorithm inline. Would benefit from extraction into a utility function.

2. **No duplicate snapshot name validation** — Users can create snapshots with duplicate names.

### `src/services/orchestrationService.ts` — ✅ Good

Well-structured service management with proper terminal lifecycle handling.

### `src/services/notificationService.ts` — ✅ Good

Clean change detection with configurable notification preferences.

### `media/main.js` — ⚠️ Medium Priority

**Issues Found:**

1. **No input sanitization** — User inputs in service creation forms are inserted into the DOM without escaping, creating potential XSS vectors in the webview context.

2. **Global state** — All state is managed via global variables (`currentData`, `currentFilters`, `currentSort`, etc.) rather than a state management pattern.

3. **No error handling** — API calls via `vscode.postMessage()` have no error callbacks or timeout handling.

4. **Magic strings** — DOM element IDs like `"btn-refresh"`, `"tab-ports"` are hardcoded throughout.

### `media/styles.css` — ✅ Good

Well-organized CSS using VS Code theme variables for consistent styling.

### Type Definitions (`src/types/`) — ✅ Good

Clean interface definitions. `orchestration.ts` includes useful auto-detection maps (`PORT_ROLE_MAP`, `PROCESS_HINTS`).

---

## Security Findings

| ID | Severity | Component | Finding |
|---|---|---|---|
| SEC-1 | 🟠 Medium | `actions/process.py` | PID passed to `taskkill` without validation. While restricted to integers by the type system, there's no range check or sanitization before subprocess execution. |
| SEC-2 | 🟡 Low | `storage/snapshot.py` | `json.load()` on user-accessible files without schema validation. A crafted JSON file could cause unexpected behavior in downstream processing. |
| SEC-3 | 🟡 Low | `storage/snapshot.py` | Snapshot file paths are not sanitized against directory traversal. The `load_snapshot()` function joins user-provided filenames directly to the snapshot directory. |
| SEC-4 | 🟡 Low | `media/main.js` | User inputs in service creation/editing are rendered into HTML without proper escaping. While running in a VS Code webview sandbox, this is still a defense-in-depth concern. |
| SEC-5 | 🟢 Info | `collectors/windows.py` | Subprocess calls use list-form arguments (not shell=True), which is the correct approach for preventing shell injection. |
| SEC-6 | 🟢 Info | `cliRunner.ts` | CLI spawning uses `execFile` (not `exec`), avoiding shell injection. |

---

## Testing & Quality

### Test Coverage: ❌ None

The repository has **zero automated tests** — no unit tests, integration tests, or end-to-end tests for either the Python CLI or the VS Code extension.

**Impact:**
- No regression safety net for code changes
- No validation of edge cases in parsing logic
- No confidence in cross-version Python compatibility
- Refactoring is risky without test coverage

### Recommended Test Priorities

1. **`collectors/windows.py`** — Unit tests for netstat/tasklist output parsing with sample data
2. **`core/processors.py`** — Unit tests for all filtering and grouping functions
3. **`storage/snapshot.py`** — Unit tests for save/load/diff with fixture files
4. **`actions/process.py`** — Unit tests with mocked subprocess calls
5. **`cli/commands.py`** — Integration tests for each command handler
6. **`src/services/snapshotService.ts`** — Unit tests for snapshot comparison logic
7. **`media/main.js`** — UI interaction tests

### Code Quality Tools: ❌ Not Configured

- No linter configured (no flake8, pylint, ruff, or mypy for Python)
- No ESLint configured for TypeScript/JavaScript
- No pre-commit hooks
- No CI/CD pipeline defined (no GitHub Actions workflows)
- No code formatting tool (no black, prettier)

---

## Documentation Review

### README.md: ✅ Excellent

- Comprehensive feature documentation
- Clear installation instructions for both CLI and extension
- Usage examples for all major commands
- Architecture overview with layer descriptions
- Well-organized project structure diagram
- Future roadmap clearly laid out
- Appropriate badges and licensing

### Inline Documentation: 🟡 Adequate

- Python files have minimal docstrings (only a few functions documented)
- TypeScript files have no JSDoc comments
- Complex logic (netstat parsing, snapshot diffing) lacks explanatory comments
- No API documentation for the core engine functions

### Missing Documentation:

- No CONTRIBUTING.md with development setup instructions
- No CHANGELOG.md tracking version history
- No developer documentation for extension development/debugging
- No architecture decision records (ADRs)

---

## Recommendations

### 🔴 Critical (Should Fix Before Next Release)

1. **Add a test suite** — Start with unit tests for `collectors/windows.py` and `core/processors.py`. Use pytest for Python and the VS Code test framework for the extension.

2. **Add error handling to `collectors/windows.py`** — Wrap subprocess calls in try/except, validate parsed output, add platform detection guard.

3. **Add input validation** — Validate port numbers (1–65535), PIDs (positive integers), and snapshot filenames in both CLI and extension.

### 🟠 Important (Should Fix Soon)

4. **Add CI/CD pipeline** — Create a GitHub Actions workflow for linting, testing, and building on push/PR.

5. **Configure linters** — Add ruff or flake8 for Python, ESLint for TypeScript, and a formatter (black/prettier).

6. **Split large files** — Break `commands.py` into per-command modules. Split `dashboardViewProvider.ts` into separate handler classes.

7. **Fix silent error suppression** — Replace empty `catch {}` blocks with proper error logging in `resourceMonitor.ts`.

8. **Fix type safety issues** — Replace `as any` casts in `dashboardViewProvider.ts` with proper typed message interfaces.

### 🟡 Nice to Have (Future Improvements)

9. **Add cross-platform support** — Implement `collectors/linux.py` and `collectors/macos.py` with a factory pattern.

10. **Add atomic file writes** — Use write-to-temp-then-rename pattern for snapshot persistence.

11. **Add a state management pattern** — Replace global variables in `media/main.js` with a lightweight state manager.

12. **Add developer documentation** — Document extension development setup, debugging workflow, and architecture decisions.

13. **Add CHANGELOG.md** — Track changes across versions for users and contributors.

---

## Summary Table

| Component | Quality | Issues | Priority |
|---|---|---|---|
| **Architecture** | ✅ Good | Large files need splitting | 🟠 Medium |
| **Python Core Engine** | ✅ Good | Clean models and processors | — |
| **Python Collectors** | ⚠️ Fragile | No error handling, brittle parsing | 🔴 High |
| **Python CLI** | ✅ Good | Missing input validation | 🟠 Medium |
| **Python Storage** | 🟡 Adequate | No corruption handling | 🟠 Medium |
| **Extension Core** | ✅ Good | Clean activation/deactivation | — |
| **Extension Dashboard** | ⚠️ Oversized | 1,012 lines, weak typing | 🟠 Medium |
| **Extension Services** | ✅ Good | Minor type safety issues | 🟡 Low |
| **Extension UI (JS/CSS)** | 🟡 Adequate | No input sanitization, global state | 🟠 Medium |
| **Tests** | ❌ None | Zero test coverage | 🔴 Critical |
| **CI/CD** | ❌ None | No workflows configured | 🔴 Critical |
| **Documentation** | ✅ Good | README excellent; inline docs minimal | 🟡 Low |
| **Security** | 🟡 Adequate | No critical issues; defense-in-depth needed | 🟠 Medium |

---

**Overall Rating: 🟡 Good foundation with important gaps**

The codebase demonstrates solid architectural thinking and a well-scoped feature set. The primary gaps — lack of tests, missing error handling in the data collection layer, and absence of CI/CD — are typical for early-stage projects and are straightforward to address. The project is well-positioned for growth with targeted improvements in reliability and quality infrastructure.
