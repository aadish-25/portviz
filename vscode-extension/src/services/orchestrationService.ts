import * as vscode from 'vscode';
import { PortEntry } from '../types/report';
import {
  Service, ServiceState, ServiceStatus,
  DetectedService,
  PORT_ROLE_MAP, PROCESS_HINTS
} from '../types/orchestration';

const STORAGE_KEY = 'portviz.orchestration.services';

export class OrchestrationService {

  /** Terminal instances keyed by service ID */
  private _terminals = new Map<string, vscode.Terminal>();

  /** Services currently in "starting" state */
  private _startingIds = new Set<string>();

  /** Track start times for timeout detection */
  private _startTimes = new Map<string, number>();

  /** Services that failed to start (timed out) */
  private _errorIds = new Set<string>();

  /** Service start timeout in milliseconds (30 seconds) */
  private readonly START_TIMEOUT = 30000;

  /** Disposables for cleanup */
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _state: vscode.Memento) {
    // Clean up stale terminal references when user closes a terminal
    this._disposables.push(
      vscode.window.onDidCloseTerminal((closed) => {
        for (const [id, terminal] of this._terminals) {
          if (terminal === closed) {
            this._terminals.delete(id);
            this._startingIds.delete(id);
            this._startTimes.delete(id);
            break;
          }
        }
      })
    );
  }

  // ─── DETECTION ──────────────────────────────

  /**
   * Scan live port data and detect dev services.
   * Filters to TCP LISTENING on known dev ports or common dev processes.
   */
  detectServices(liveData: PortEntry[]): DetectedService[] {
    const listening = liveData.filter(p => p.protocol === 'TCP' && p.state === 'LISTENING');
    const savedIds = new Set(this.getSavedServices().map(s => s.port));
    const seen = new Set<string>();
    const results: DetectedService[] = [];

    for (const p of listening) {
      // Skip system ports and already-saved
      if (p.pid === 0 || p.pid === 4) { continue; }
      if (savedIds.has(p.local_port)) { continue; }

      const portInfo = PORT_ROLE_MAP[p.local_port];
      const procName = (p.process_name ?? '').toLowerCase();
      const procInfo = PROCESS_HINTS[procName];

      if (!portInfo && !procInfo) { continue; }

      const key = `${p.local_port}-${p.pid}`;
      if (seen.has(key)) { continue; }
      seen.add(key);

      const info = portInfo ?? procInfo!;
      results.push({
        name: info.framework,
        role: info.role,
        port: p.local_port,
        pid: p.pid,
        processName: p.process_name ?? 'Unknown',
        framework: info.framework
      });
    }

    return results;
  }

  // ─── CRUD ───────────────────────────────────

  getSavedServices(): Service[] {
    return this._state.get<Service[]>(STORAGE_KEY, []);
  }

  saveService(service: Service): void {
    const all = this.getSavedServices();
    const idx = all.findIndex(s => s.id === service.id);
    if (idx >= 0) { all[idx] = service; } else { all.push(service); }
    this._persist(all);
  }

  deleteService(id: string): void {
    const all = this.getSavedServices().filter(s => s.id !== id);
    this._persist(all);
    this._disposeTerminal(id);
  }

  updateService(id: string, updates: Partial<Omit<Service, 'id'>>): void {
    const all = this.getSavedServices();
    const svc = all.find(s => s.id === id);
    if (!svc) { return; }
    Object.assign(svc, updates);
    this._persist(all);
  }

  /**
   * Remove the group property from all services in a given group.
   */
  removeGroupFromServices(group: string): void {
    const all = this.getSavedServices();
    for (const svc of all) {
      if (svc.group === group) {
        delete svc.group;
      }
    }
    this._persist(all);
  }

  /** Generate a unique service ID */
  generateId(): string {
    return this._generateId();
  }

  // ─── STATUS RECONCILIATION ──────────────────

  /**
   * Reconcile saved services with live port data.
   * Returns enriched ServiceState[] with runtime status.
   */
  reconcileStatus(liveData: PortEntry[]): ServiceState[] {
    const saved = this.getSavedServices();
    const listeningPorts = new Map<number, PortEntry>();

    for (const p of liveData) {
      if (p.protocol === 'TCP' && p.state === 'LISTENING') {
        listeningPorts.set(p.local_port, p);
      }
    }

    // Check for timeouts on services that are still starting
    const now = Date.now();
    for (const serviceId of this._startingIds) {
      const startTime = this._startTimes.get(serviceId);
      if (startTime && (now - startTime) > this.START_TIMEOUT) {
        this._startingIds.delete(serviceId);
        this._startTimes.delete(serviceId);
        this._errorIds.add(serviceId);
        // Find service name for the error message
        const svc = saved.find(s => s.id === serviceId);
        const svcName = svc ? svc.name : 'Unknown';
        vscode.window.showErrorMessage(
          `Service "${svcName}" did not start within ${this.START_TIMEOUT / 1000}s. Check its commands, working directory, and port configuration.`
        );
      }
    }

    return saved.map(svc => {
      let status: ServiceStatus = 'stopped';

      if (this._startingIds.has(svc.id)) {
        status = 'starting';
      } else if (this._errorIds.has(svc.id)) {
        status = 'error';
      } else if (svc.port && listeningPorts.has(svc.port)) {
        status = 'running';
        // Update linked PID from live data
        svc.linkedPid = listeningPorts.get(svc.port)!.pid;
        // Clear start time since service successfully started
        this._startTimes.delete(svc.id);
      }

      return { ...svc, status };
    });
  }

  // ─── EXECUTION ──────────────────────────────

  async startService(service: Service): Promise<void> {
    if (service.startCommands.length === 0) {
      vscode.window.showWarningMessage(`Service "${service.name}" has no start commands.`);
      return;
    }

    this._startingIds.add(service.id);
    this._startTimes.set(service.id, Date.now());
    this._errorIds.delete(service.id); // Clear previous error on retry

    // Reuse or create terminal
    let terminal = this._terminals.get(service.id);
    if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal({
        name: `Portviz: ${service.name}`,
        cwd: service.workingDirectory,
        ...(service.envVars ? { env: service.envVars } : {}),
      });
      this._terminals.set(service.id, terminal);
    }

    terminal.show(false);

    // Send commands one-by-one to support PowerShell 5.1 (which lacks && operator)
    for (const cmd of service.startCommands) {
      terminal.sendText(cmd);
    }
  }

  stopService(service: Service): void {
    const terminal = this._terminals.get(service.id);
    if (terminal && terminal.exitStatus === undefined) {
      terminal.dispose();
    }
    this._terminals.delete(service.id);
    this._startingIds.delete(service.id);
    this._startTimes.delete(service.id);
    this._errorIds.delete(service.id);
  }

  // ─── HELPERS ────────────────────────────────

  private _persist(services: Service[]): void {
    this._state.update(STORAGE_KEY, services);
  }

  private _generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  private _disposeTerminal(id: string): void {
    const terminal = this._terminals.get(id);
    if (terminal && terminal.exitStatus === undefined) {
      terminal.dispose();
    }
    this._terminals.delete(id);
    this._startingIds.delete(id);
    this._errorIds.delete(id);
  }

  dispose(): void {
    for (const d of this._disposables) { d.dispose(); }
    this._disposables = [];
    for (const [, terminal] of this._terminals) {
      if (terminal.exitStatus === undefined) { terminal.dispose(); }
    }
    this._terminals.clear();
    this._startingIds.clear();
    this._errorIds.clear();
  }
}
