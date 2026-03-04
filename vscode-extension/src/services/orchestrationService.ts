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

  /** Get the configured service start timeout in milliseconds */
  private get START_TIMEOUT(): number {
    return vscode.workspace.getConfiguration('portviz').get<number>('serviceStartTimeout', 30) * 1000;
  }

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
      // Hardcode start commands based on role/framework
      let startCommands: string[] = [];
      switch (info.framework) {
        case 'React / Next.js':
        case 'React (alt)':
        case 'Angular':
        case 'Vite':
        case 'Vite (alt)':
        case 'Vue / Webpack Dev Server':
        case 'Astro':
          startCommands = ['npm start', 'yarn start', 'pnpm start'];
          break;
        case 'Flask / Express':
          startCommands = ['flask run', 'npm run dev', 'node app.js'];
          break;
        case 'Django / Uvicorn':
          startCommands = ['python manage.py runserver', 'uvicorn main:app'];
          break;
        case 'FastAPI (alt)':
          startCommands = ['uvicorn main:app'];
          break;
        case 'GraphQL / NestJS':
          startCommands = ['npm run start:dev', 'node server.js'];
          break;
        case 'PHP-FPM':
          startCommands = ['php-fpm'];
          break;
        case 'PostgreSQL':
          startCommands = ['pg_ctl start'];
          break;
        case 'MySQL':
          startCommands = ['mysqld'];
          break;
        case 'MongoDB':
          startCommands = ['mongod'];
          break;
        case 'SQL Server':
          startCommands = ['sqlservr'];
          break;
        case 'Redis':
          startCommands = ['redis-server'];
          break;
        case 'Memcached':
          startCommands = ['memcached'];
          break;
        case 'Node.js':
          startCommands = ['npm start', 'node app.js'];
          break;
        case 'Python':
          startCommands = ['python app.py'];
          break;
        case 'Uvicorn':
          startCommands = ['uvicorn main:app'];
          break;
        case 'Gunicorn':
          startCommands = ['gunicorn app:app'];
          break;
        case 'Java':
          startCommands = ['mvn spring-boot:run', 'java -jar app.jar'];
          break;
        default:
          startCommands = [];
      }
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

    // Check for timeouts — only if notifications enabled
    const notifyTimeout = vscode.workspace.getConfiguration('portviz').get<boolean>('notifications.serviceStartTimeout', false);
    const now = Date.now();
    for (const serviceId of [...this._startingIds]) {
      const startTime = this._startTimes.get(serviceId);
      if (startTime && (now - startTime) > this.START_TIMEOUT) {
        this._startingIds.delete(serviceId);
        this._startTimes.delete(serviceId);
        this._errorIds.add(serviceId);
        if (notifyTimeout) {
          const svc = saved.find(s => s.id === serviceId);
          const svcName = svc ? svc.name : 'Unknown';
          vscode.window.showErrorMessage(
            `Service "${svcName}" did not start within ${this.START_TIMEOUT / 1000}s. Check its commands, working directory, and port configuration.`
          );
        }
      }
    }

    return saved.map(svc => {
      let status: ServiceStatus = 'stopped';

      if (svc.port && listeningPorts.has(svc.port)) {
        // Port is live — service is running, clear any starting state
        status = 'running';
        this._startingIds.delete(svc.id);
        this._startTimes.delete(svc.id);
        this._errorIds.delete(svc.id);
        svc.linkedPid = listeningPorts.get(svc.port)!.pid;
      } else if (this._startingIds.has(svc.id)) {
        status = 'starting';
      } else if (this._errorIds.has(svc.id)) {
        status = 'error';
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

    // Try each start command in order, check for port after each
    for (const cmd of service.startCommands) {
      if (typeof cmd === 'string' && cmd.length > 0) {
        terminal.sendText(cmd);
        // Wait for a short period, then check if port is live
        await new Promise(res => setTimeout(res, 3000)); // 3s delay (tweak as needed)
        // Check if port is live
        const isLive = await this._isServicePortLive(service);
        if (isLive) {
          break;
        }
      }
    }
  }

  /** Check if the service port is live (listening) */
  private async _isServicePortLive(service: Service): Promise<boolean> {
    // This should call into the port detection logic, e.g., by reusing reconcileStatus or similar
    // For now, we assume a global method getLivePorts() exists (replace with actual logic)
    // You may need to refactor to pass live port data or trigger a refresh
    // Example stub:
    // const livePorts = await getLivePorts();
    // return livePorts.some(p => p.local_port === service.port);
    // For now, always return false (replace with real check)
    return false;
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
