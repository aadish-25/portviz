import * as vscode from 'vscode';
import { PortEntry } from '../types/report';
import {
  Service, ServiceRole, ServiceState, ServiceStatus,
  DetectedService, ProjectProfile,
  PORT_ROLE_MAP, PROCESS_HINTS
} from '../types/orchestration';

const STORAGE_KEY = 'portviz.orchestration.services';
const PROFILE_KEY = 'portviz.orchestration.profile';

export class OrchestrationService {

  /** Terminal instances keyed by service ID */
  private _terminals = new Map<string, vscode.Terminal>();

  /** Services currently in "starting" state */
  private _startingIds = new Set<string>();

  /** Track start times for timeout detection */
  private _startTimes = new Map<string, number>();

  /** Service start timeout in milliseconds (10 seconds) */
  private readonly START_TIMEOUT = 10000;

  constructor(private readonly _state: vscode.Memento) { }

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
    this._state.update(STORAGE_KEY, all);
  }

  deleteService(id: string): void {
    const all = this.getSavedServices().filter(s => s.id !== id);
    this._state.update(STORAGE_KEY, all);
    this._disposeTerminal(id);
  }

  createServiceFromDetection(detected: DetectedService, workingDirectory: string): Service {
    const service: Service = {
      id: this._generateId(),
      name: detected.name,
      role: detected.role,
      port: detected.port,
      startCommands: [],
      workingDirectory,
      autoDetected: true,
      linkedPid: detected.pid
    };
    this.saveService(service);
    return service;
  }

  createManualService(
    name: string, role: ServiceRole, port: number | undefined,
    startCommands: string[], workingDirectory: string
  ): Service {
    const service: Service = {
      id: this._generateId(),
      name,
      role,
      ...(port !== undefined && { port }),
      startCommands,
      workingDirectory,
      autoDetected: false
    };
    this.saveService(service);
    return service;
  }

  updateService(id: string, updates: Partial<Omit<Service, 'id'>>): void {
    const all = this.getSavedServices();
    const svc = all.find(s => s.id === id);
    if (!svc) { return; }
    Object.assign(svc, updates);
    this._state.update(STORAGE_KEY, all);
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
      }
    }

    return saved.map(svc => {
      let status: ServiceStatus = 'stopped';

      if (this._startingIds.has(svc.id)) {
        status = 'starting';
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

    // Reuse or create terminal
    let terminal = this._terminals.get(service.id);
    if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal({
        name: `Portviz: ${service.name}`,
        cwd: service.workingDirectory
      });
      this._terminals.set(service.id, terminal);
    }

    terminal.show(false);

    // Send commands sequentially via && chaining
    // For multi-command (e.g. venv activate), keep same session
    const cmdChain = service.startCommands.join(' && ');
    terminal.sendText(cmdChain);
  }

  stopService(service: Service): void {
    const terminal = this._terminals.get(service.id);
    if (terminal && terminal.exitStatus === undefined) {
      terminal.dispose();
    }
    this._terminals.delete(service.id);
    this._startingIds.delete(service.id);
    this._startTimes.delete(service.id);
  }

  // ─── PROJECT PROFILES ───────────────────────

  getProfile(): ProjectProfile | undefined {
    return this._state.get<ProjectProfile>(PROFILE_KEY);
  }

  saveProfile(name: string): void {
    const services = this.getSavedServices();
    this._state.update(PROFILE_KEY, { projectName: name, services });
  }

  loadProfile(): Service[] | undefined {
    const profile = this.getProfile();
    if (!profile) { return undefined; }

    // Merge with existing: don't duplicate
    const existing = this.getSavedServices();
    const existingIds = new Set(existing.map(s => s.id));
    const merged = [...existing];

    for (const svc of profile.services) {
      if (!existingIds.has(svc.id)) {
        merged.push(svc);
      }
    }

    this._state.update(STORAGE_KEY, merged);
    return merged;
  }

  // ─── PACKAGE.JSON DETECTION ─────────────────

  async detectFromPackageJson(workspaceRoot: string): Promise<{ script: string; command: string }[]> {
    try {
      const uri = vscode.Uri.file(`${workspaceRoot}/package.json`);
      const content = await vscode.workspace.fs.readFile(uri);
      const pkg = JSON.parse(Buffer.from(content).toString('utf-8'));
      const scripts = pkg.scripts ?? {};

      return Object.entries(scripts).map(([key, val]) => ({
        script: key,
        command: val as string
      }));
    } catch {
      return [];
    }
  }

  // ─── HELPERS ────────────────────────────────

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
  }

  dispose(): void {
    for (const [, terminal] of this._terminals) {
      if (terminal.exitStatus === undefined) { terminal.dispose(); }
    }
    this._terminals.clear();
    this._startingIds.clear();
  }
}
