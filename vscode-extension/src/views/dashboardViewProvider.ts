import * as vscode from 'vscode';
import { CliRunner } from '../services/cliRunner';
import { SnapshotService } from '../services/snapshotService';
import { OrchestrationService } from '../services/orchestrationService';
import { NotificationService } from '../services/notificationService';
import { ResourceMonitor } from '../services/resourceMonitor';
import { PortEntry } from '../types/report';

// ─── Data Types ───

interface ProcessGroup {
  name: string;
  pid: number;
  ports: (PortEntry & { frameworkHint?: string })[];
}

interface FilterState {
  hideSystem: boolean;
  publicOnly: boolean;
  showUdp: boolean;
}

type SortMode = 'name' | 'pid' | 'ports';

// ─── Provider ───

export class DashboardViewProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'portviz.dashboard';

  private _view: vscode.WebviewView | undefined;
  private _rawData: PortEntry[] = [];
  private _filters: FilterState = { hideSystem: true, publicOnly: false, showUdp: false };
  private _sortMode: SortMode = 'name';
  private _autoRefreshInterval?: ReturnType<typeof setInterval>;
  private _previousPids: Set<number> = new Set();
  private _isRefreshing = false;
  private readonly _snapshotService: SnapshotService;
  private readonly _orchestrationService: OrchestrationService;
  private readonly _notificationService: NotificationService;
  private readonly _resourceMonitor: ResourceMonitor;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    globalState: vscode.Memento,
    orchestrationService: OrchestrationService,
    notificationService: NotificationService,
    resourceMonitor: ResourceMonitor
  ) {
    this._snapshotService = new SnapshotService(globalState);
    this._orchestrationService = orchestrationService;
    this._notificationService = notificationService;
    this._resourceMonitor = resourceMonitor;

    // Forward resource updates to webview
    this._resourceMonitor.onUpdate((cache) => {
      if (!this._view) { return; }
      const resources: Record<number, { cpu: number; memoryMB: number }> = {};
      for (const [pid, r] of cache) {
        resources[pid] = { cpu: r.cpu, memoryMB: r.memoryMB };
      }
      this._view.webview.postMessage({ type: 'resourceUpdate', data: resources });
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
    };

    const stylesUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css'));
    const scriptUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

    webviewView.webview.html = this._getHtml(stylesUri, scriptUri);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'refresh':
          await this.refresh();
          break;
        case 'kill':
          await this._handleKill(msg.pid, msg.processName, msg.portCount);
          break;
        case 'open':
          this._handleOpen(msg.port, msg.ip);
          break;
        case 'filterChange':
          this._filters = msg.filters;
          this._sendFilteredData();
          break;
        case 'sortChange':
          this._sortMode = msg.sort;
          this._sendFilteredData();
          break;
        case 'autoRefreshChange':
          this._handleAutoRefresh(msg.enabled);
          break;

        // ── Snapshot messages ──
        case 'snapshotSave':
          await this._handleSnapshotSave();
          break;
        case 'snapshotDelete':
          this._handleSnapshotDelete(msg.id);
          break;
        case 'snapshotRename':
          await this._handleSnapshotRename(msg.id);
          break;
        case 'snapshotCompare':
          this._handleSnapshotCompare(msg.idA, msg.idB);
          break;
        case 'snapshotCompareWithCurrent':
          this._handleSnapshotCompareWithCurrent(msg.id);
          break;
        case 'snapshotList':
          this._sendSnapshotList();
          break;

        // ── Orchestration messages ──
        case 'orchLoad':
          this._sendOrchestrationData();
          break;
        case 'orchDetect':
          await this._handleOrchDetect();
          break;
        case 'orchCreateService':
          await this._handleOrchCreateService(msg.service);
          break;
        case 'orchEditService':
          await this._handleOrchEditService(msg.id, msg.service);
          break;
        case 'orchDeleteService':
          await this._handleOrchDeleteService(msg.id);
          break;
        case 'orchStartService':
          await this._handleOrchStartService(msg.id);
          break;
        case 'orchStopService':
          await this._handleOrchStopService(msg.id);
          break;
        case 'orchAcceptDetection':
          await this._handleOrchAcceptDetection(msg.detected);
          break;
        case 'orchDuplicateService':
          await this._handleOrchDuplicateService(msg.id);
          break;
        case 'orchStartGroup':
          await this._handleOrchStartGroup(msg.group);
          break;
        case 'orchStopGroup':
          await this._handleOrchStopGroup(msg.group);
          break;
        case 'orchUngroupStack':
          await this._handleOrchUngroupStack(msg.group);
          break;
        case 'orchDeleteStack':
          await this._handleOrchDeleteStack(msg.group);
          break;

        // ── Watch port notifications ──
        case 'watchPort':
          this._notificationService.addWatch(msg.port);
          break;
        case 'unwatchPort':
          this._notificationService.removeWatch(msg.port);
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this._clearAutoRefresh();
      this._view = undefined;
    });

    // Fire-and-forget initial refresh
    this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this._isRefreshing) { return; }
    this._isRefreshing = true;

    this._view?.webview.postMessage({ type: 'loadingStart' });

    try {
      const runner = new CliRunner();
      const result = await runner.runReport();

      if (!result.success || !result.data) {
        this._view?.webview.postMessage({
          type: 'cliMissing',
          error: result.error ?? 'Failed to load Portviz data'
        });
        return;
      }

      this._rawData = result.data;
      this._sendFilteredData();
      this._sendOverviewData();
      this._sendSnapshotList();
      this._sendOrchestrationData();

      // Notification service: detect port changes
      this._notificationService.check(this._rawData);

      // Resource monitor: track active PIDs
      const activePids = this._rawData
        .filter(p => p.protocol === 'TCP' && p.state === 'LISTENING')
        .map(p => p.pid);
      this._resourceMonitor.track(activePids);
      this._resourceMonitor.startPolling();
    } catch (error) {
      this._view?.webview.postMessage({
        type: 'cliMissing',
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this._isRefreshing = false;
      this._view?.webview.postMessage({ type: 'loadingEnd' });
    }
  }

  // ─── LIVE TAB DATA ───

  private _sendFilteredData(): void {
    if (!this._view) { return; }

    let filtered = [...this._rawData];

    filtered = filtered.filter(p => {
      if (p.protocol === 'UDP') { return this._filters.showUdp; }
      return p.protocol === 'TCP' && p.state === 'LISTENING';
    });

    if (this._filters.hideSystem) {
      filtered = filtered.filter(p => {
        const name = (p.process_name ?? '').toLowerCase();
        return !name.includes('system') && p.pid !== 0 && p.pid !== 4;
      });
    }

    if (this._filters.publicOnly) {
      filtered = filtered.filter(p => p.local_ip === '0.0.0.0');
    }

    const groups = this._groupByProcess(filtered);
    this._sortGroups(groups);

    const currentPids = new Set(groups.map(g => g.pid));
    const newPids = groups
      .filter(g => !this._previousPids.has(g.pid))
      .map(g => g.pid);
    this._previousPids = currentPids;

    // Attach framework hints
    for (const g of groups) {
      for (const p of g.ports) {
        (p as any).frameworkHint = this._detectFramework(p, g.name);
      }
    }

    // Overall summary (unfiltered)
    const allListening = this._rawData.filter(p =>
      (p.protocol === 'TCP' && p.state === 'LISTENING') || p.protocol === 'UDP'
    );
    const allGroups = this._groupByProcess(allListening);
    let totalPortsAll = 0;
    let publicCountAll = 0;
    for (const g of allGroups) {
      for (const p of g.ports) {
        totalPortsAll++;
        if (p.local_ip === '0.0.0.0') { publicCountAll++; }
      }
    }

    // Gather resource data for all visible PIDs
    const visiblePids = groups.map(g => g.pid);
    const resourceData = this._resourceMonitor.getFor(visiblePids);
    const resources: Record<number, { cpu: number; memoryMB: number }> = {};
    for (const pid of visiblePids) {
      const r = resourceData[pid];
      if (r) { resources[pid] = { cpu: r.cpu, memoryMB: r.memoryMB }; }
    }

    this._view.webview.postMessage({
      type: 'liveUpdate',
      data: groups,
      newPids,
      resources,
      summary: {
        processes: allGroups.length,
        ports: totalPortsAll,
        publicPorts: publicCountAll
      }
    });
  }

  // ─── OVERVIEW TAB DATA ───

  private _sendOverviewData(): void {
    if (!this._view) { return; }

    const listening = this._rawData.filter(p =>
      (p.protocol === 'TCP' && p.state === 'LISTENING') || p.protocol === 'UDP'
    );

    const processSet = new Set(listening.map(p => `${p.process_name}-${p.pid}`));
    const publicPorts = listening.filter(p => p.local_ip === '0.0.0.0');
    const udpPorts = listening.filter(p => p.protocol === 'UDP');

    // Group public services by process (no duplicates)
    const riskMap = new Map<string, { name: string; pid: number; ports: number[]; severity: 'high' | 'medium' | 'low' }>();
    const sysProcesses = ['system', 'svchost', 'wininit', 'lsass', 'services', 'csrss', 'smss'];

    for (const p of publicPorts) {
      const key = `${p.process_name}-${p.pid}`;
      if (!riskMap.has(key)) {
        const pn = (p.process_name ?? '').toLowerCase();
        const isSystem = sysProcesses.some(s => pn.includes(s));
        riskMap.set(key, {
          name: p.process_name ?? 'Unknown',
          pid: p.pid,
          ports: [],
          severity: isSystem ? 'high' : 'medium'
        });
      }
      const entry = riskMap.get(key)!;
      if (!entry.ports.includes(p.local_port)) {
        entry.ports.push(p.local_port);
      }
    }

    // Sort: high first, then medium
    const riskServices = Array.from(riskMap.values())
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.severity] - order[b.severity];
      });

    this._view.webview.postMessage({
      type: 'overviewUpdate',
      data: {
        totalProcesses: processSet.size,
        listeningPorts: listening.length,
        publicPorts: publicPorts.length,
        udpPorts: udpPorts.length,
        lastUpdated: new Date().toLocaleTimeString(),
        riskServices
      }
    });
  }

  // ─── HELPERS ───

  private _groupByProcess(entries: PortEntry[]): ProcessGroup[] {
    const map = new Map<string, ProcessGroup>();
    for (const entry of entries) {
      const key = `${entry.process_name ?? 'Unknown'}-${entry.pid}`;
      if (!map.has(key)) {
        map.set(key, { name: entry.process_name ?? 'Unknown', pid: entry.pid, ports: [] });
      }
      map.get(key)!.ports.push(entry);
    }
    return Array.from(map.values());
  }

  private _sortGroups(groups: ProcessGroup[]): void {
    groups.sort((a, b) => {
      const aSystem = a.name.toLowerCase().includes('system');
      const bSystem = b.name.toLowerCase().includes('system');
      if (aSystem && !bSystem) { return 1; }
      if (!aSystem && bSystem) { return -1; }
      switch (this._sortMode) {
        case 'pid': return a.pid - b.pid;
        case 'ports': return b.ports.length - a.ports.length;
        default: return a.name.localeCompare(b.name);
      }
    });
  }

  private _detectFramework(port: PortEntry, processName: string): string | undefined {
    const pn = (processName ?? '').toLowerCase();
    const p = port.local_port;

    // ── PRIORITY 1: Detect by process name (ground truth) ──
    if (pn.includes('next')) { return 'Next.js'; }
    if (pn.includes('vite')) { return 'Vite'; }
    if (pn.includes('angular')) { return 'Angular'; }
    if (pn.includes('uvicorn') || pn.includes('gunicorn')) { return 'Python'; }
    if (pn.includes('flask')) { return 'Flask'; }
    if (pn.includes('django')) { return 'Django'; }
    if (pn.includes('deno')) { return 'Deno'; }
    if (pn.includes('bun')) { return 'Bun'; }
    if (pn.includes('nginx')) { return 'Nginx'; }
    if (pn.includes('apache') || pn.includes('httpd')) { return 'Apache'; }
    if (pn.includes('docker')) { return 'Docker'; }
    if (pn.includes('postgres')) { return 'PostgreSQL'; }
    if (pn.includes('mysql')) { return 'MySQL'; }
    if (pn.includes('mongod')) { return 'MongoDB'; }
    if (pn.includes('redis') || pn.includes('memurai')) { return 'Redis'; }
    if (pn.includes('elastic') || pn.includes('opensearch')) { return 'Elasticsearch'; }
    if (pn.includes('rabbit')) { return 'RabbitMQ'; }
    if (pn.includes('sonar')) { return 'SonarQube'; }
    if (pn.includes('dotnet')) { return '.NET'; }
    if (pn.includes('ruby') || pn.includes('rails') || pn.includes('puma')) { return 'Ruby'; }
    if (pn.includes('php')) { return 'PHP'; }
    if (pn.includes('java') || pn.includes('gradle') || pn.includes('maven')) { return 'Java'; }
    if (pn.includes('python')) { return 'Python'; }
    if (pn.includes('node') || pn.includes('npm') || pn.includes('npx')) { return 'Node'; }
    if (pn.includes('go') && !pn.includes('google')) { return 'Go'; }

    // ── PRIORITY 2: Fallback by port number (convention) ──
    if (p === 3000 || p === 3001) { return 'Dev Server'; }
    if (p === 4000) { return 'Backend'; }
    if (p === 4200) { return 'Angular'; }
    if (p === 5000) { return 'Backend'; }
    if (p === 5173 || p === 5174) { return 'Vite'; }
    if (p === 8000 || p === 8080) { return 'Backend'; }
    if (p === 8888) { return 'Jupyter'; }
    if (p === 9000) { return 'Backend'; }
    if (p === 9229) { return 'Node Debug'; }
    if (p === 443 || p === 8443) { return 'HTTPS'; }
    if (p === 1433) { return 'MSSQL'; }
    if (p === 3306) { return 'MySQL'; }
    if (p === 5432) { return 'PostgreSQL'; }
    if (p === 6379) { return 'Redis'; }
    if (p === 27017) { return 'MongoDB'; }

    return undefined;
  }

  private async _handleKill(pid: number, processName?: string, portCount?: number): Promise<void> {
    const name = processName || `PID ${pid}`;
    const portInfo = portCount && portCount > 1 ? ` (${portCount} active ports)` : '';

    const confirmation = await vscode.window.showWarningMessage(
      `Kill ${name}${portInfo}?`,
      { modal: true },
      'Yes'
    );
    if (confirmation !== 'Yes') { return; }

    const runner = new CliRunner();
    const result = await runner.killProcess(pid);

    if (!result.success) {
      vscode.window.showErrorMessage(result.error ?? 'Kill failed');
      return;
    }

    await this.refresh();

    const stillAlive = this._rawData.some(p => p.pid === pid);
    if (stillAlive) {
      vscode.window.showWarningMessage(
        `${name} (PID ${pid}) may be a Windows service that auto-restarts, or requires elevated privileges to kill.`
      );
    } else {
      vscode.window.showInformationMessage(`Process ${name} (PID ${pid}) terminated`);
    }
  }

  private _handleOpen(port: number, _ip: string): void {
    vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
  }

  private _handleAutoRefresh(enabled: boolean): void {
    this._clearAutoRefresh();
    if (enabled) {
      const intervalSec = vscode.workspace.getConfiguration('portviz').get<number>('autoRefreshInterval', 5);
      this._autoRefreshInterval = setInterval(() => { this.refresh(); }, intervalSec * 1000);
    }
  }

  private _clearAutoRefresh(): void {
    if (this._autoRefreshInterval) {
      clearInterval(this._autoRefreshInterval);
      this._autoRefreshInterval = undefined as any;
    }
  }

  // ─── SNAPSHOT HANDLERS ───

  private async _handleSnapshotSave(): Promise<void> {
    if (this._rawData.length === 0) {
      vscode.window.showWarningMessage('No port data to snapshot. Refresh first.');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Name this snapshot',
      placeHolder: 'e.g. before-deploy',
      validateInput: (v) => v.trim().length === 0 ? 'Name cannot be empty' : undefined
    });

    if (!name) { return; }

    this._snapshotService.save(name.trim(), this._rawData);
    vscode.window.showInformationMessage(`Snapshot "${name.trim()}" saved`);
    this._sendSnapshotList();
  }

  private async _handleSnapshotDelete(id: string): Promise<void> {
    const snapshots = this._snapshotService.getAll();
    const snap = snapshots.find(s => s.id === id);
    if (!snap) { return; }

    const confirm = await vscode.window.showWarningMessage(
      `Delete snapshot "${snap.name}"?`,
      { modal: true },
      'Yes'
    );
    if (confirm !== 'Yes') { return; }

    this._snapshotService.delete(id);
    this._sendSnapshotList();
  }

  private async _handleSnapshotRename(id: string): Promise<void> {
    const snapshots = this._snapshotService.getAll();
    const snap = snapshots.find(s => s.id === id);
    if (!snap) { return; }

    const newName = await vscode.window.showInputBox({
      prompt: 'Rename snapshot',
      value: snap.name,
      validateInput: (v) => v.trim().length === 0 ? 'Name cannot be empty' : undefined
    });

    if (!newName) { return; }

    this._snapshotService.rename(id, newName.trim());
    this._sendSnapshotList();
  }

  private _handleSnapshotCompare(idA: string, idB: string): void {
    const diff = this._snapshotService.compare(idA, idB);
    if (!diff) {
      vscode.window.showErrorMessage('Could not compare snapshots');
      return;
    }

    this._view?.webview.postMessage({ type: 'snapshotDiff', data: diff });
  }

  private _handleSnapshotCompareWithCurrent(id: string): void {
    if (this._rawData.length === 0) {
      vscode.window.showWarningMessage('No live data available. Refresh first.');
      return;
    }

    // Create a temporary snapshot from current live data
    const tempSnap = this._snapshotService.save('__temp_current__', this._rawData);
    const diff = this._snapshotService.compare(id, tempSnap.id, true);
    this._snapshotService.delete(tempSnap.id);

    if (!diff) {
      vscode.window.showErrorMessage('Could not compare with current state');
      return;
    }

    this._view?.webview.postMessage({ type: 'snapshotDiff', data: diff });
  }

  private _sendSnapshotList(): void {
    const snapshots = this._snapshotService.getAll();
    this._view?.webview.postMessage({
      type: 'snapshotListUpdate',
      data: snapshots.map(s => {
        // Group snapshot data by process for detail view
        const procMap = new Map<string, { name: string; pid: number; ports: { port: number; ip: string; protocol: string }[] }>();
        for (const p of s.data) {
          const key = `${p.process_name ?? 'Unknown'}-${p.pid}`;
          if (!procMap.has(key)) {
            procMap.set(key, { name: p.process_name ?? 'Unknown', pid: p.pid, ports: [] });
          }
          procMap.get(key)!.ports.push({ port: p.local_port, ip: p.local_ip, protocol: p.protocol });
        }

        return {
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          portCount: s.portCount,
          publicCount: s.publicCount,
          processCount: s.processCount,
          processes: Array.from(procMap.values())
        };
      })
    });
  }

  // ── ORCHESTRATION DATA ──

  private _sendOrchestrationData(): void {
    if (!this._view) { return; }
    const detected = this._orchestrationService.detectServices(this._rawData);
    const saved = this._orchestrationService.reconcileStatus(this._rawData);

    // Collect unique groups for group-start feature
    const groups = [...new Set(saved.map(s => s.group).filter(Boolean))] as string[];

    this._view.webview.postMessage({
      type: 'orchData',
      detected,
      saved,
      groups
    });
  }

  private async _handleOrchDetect(): Promise<void> {
    this._sendOrchestrationData();
  }

  private async _handleOrchCreateService(service: any): Promise<void> {
    try {
      if (!service.id) {
        service.id = this._orchestrationService.generateId();
      }
      this._orchestrationService.saveService(service);
      this._sendOrchestrationData();
    } catch (error) {
      vscode.window.showErrorMessage('Failed to create service: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchEditService(id: string, service: any): Promise<void> {
    try {
      // If group is blank/undefined, explicitly remove it
      if (!service.group) {
        const all = this._orchestrationService.getSavedServices();
        const svc = all.find(s => s.id === id);
        if (svc && svc.group) {
          delete svc.group;
          this._orchestrationService.saveService(svc);
        }
        delete service.group;
      }
      this._orchestrationService.updateService(id, service);
      this._sendOrchestrationData();
    } catch (error) {
      vscode.window.showErrorMessage('Failed to update service: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchDeleteService(id: string): Promise<void> {
    try {
      const services = this._orchestrationService.getSavedServices();
      const svc = services.find(s => s.id === id);
      const name = svc?.name ?? 'this service';

      const confirm = await vscode.window.showWarningMessage(
        `Delete service "${name}"?`,
        { modal: true },
        'Yes'
      );
      if (confirm !== 'Yes') { return; }

      this._orchestrationService.deleteService(id);
      this._sendOrchestrationData();
    } catch (error) {
      vscode.window.showErrorMessage('Failed to delete service: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchStartService(id: string): Promise<void> {
    try {
      const service = this._orchestrationService.getSavedServices().find(s => s.id === id);
      if (!service) {
        vscode.window.showErrorMessage('Service not found');
        return;
      }
      await this._orchestrationService.startService(service);
      this._sendOrchestrationData(); // immediate – shows "starting"

      // Schedule delayed refreshes to re-scan ports and update status
      // Services take varying time to start listening on their port
      const refreshAndUpdate = () => { if (this._view) { this.refresh(); } };
      setTimeout(refreshAndUpdate, 2000);
      setTimeout(refreshAndUpdate, 5000);
      setTimeout(refreshAndUpdate, 10000);
    } catch (error) {
      vscode.window.showErrorMessage('Failed to start service: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchStopService(id: string): Promise<void> {
    try {
      const service = this._orchestrationService.getSavedServices().find(s => s.id === id);
      if (!service) {
        vscode.window.showErrorMessage('Service not found');
        return;
      }
      this._orchestrationService.stopService(service);
      this._sendOrchestrationData(); // immediate – shows "stopped"

      // Delayed refresh to confirm port is freed
      setTimeout(() => { if (this._view) { this.refresh(); } }, 2000);
    } catch (error) {
      vscode.window.showErrorMessage('Failed to stop service: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchDuplicateService(id: string): Promise<void> {
    try {
      const services = this._orchestrationService.getSavedServices();
      const source = services.find(s => s.id === id);
      if (!source) { return; }
      const clone = { ...source, id: this._orchestrationService.generateId(), name: source.name + ' (copy)', autoDetected: false };
      this._orchestrationService.saveService(clone);
      this._sendOrchestrationData();
    } catch (error) {
      vscode.window.showErrorMessage('Failed to duplicate service: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchStartGroup(group: string): Promise<void> {
    try {
      const services = this._orchestrationService.getSavedServices().filter(s => s.group === group);
      for (const service of services) {
        if (service.startCommands.length > 0) {
          await this._orchestrationService.startService(service);
        }
      }
      this._sendOrchestrationData();
      const refreshAndUpdate = () => this.refresh();
      setTimeout(refreshAndUpdate, 2000);
      setTimeout(refreshAndUpdate, 5000);
      setTimeout(refreshAndUpdate, 10000);
    } catch (error) {
      vscode.window.showErrorMessage('Failed to start group: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchStopGroup(group: string): Promise<void> {
    try {
      const services = this._orchestrationService.getSavedServices().filter(s => s.group === group);
      for (const service of services) {
        this._orchestrationService.stopService(service);
      }
      this._sendOrchestrationData();
      setTimeout(() => { if (this._view) { this.refresh(); } }, 2000);
    } catch (error) {
      vscode.window.showErrorMessage('Failed to stop group: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchUngroupStack(group: string): Promise<void> {
    try {
      this._orchestrationService.removeGroupFromServices(group);
      this._sendOrchestrationData();
    } catch (error) {
      vscode.window.showErrorMessage('Failed to ungroup stack: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchDeleteStack(group: string): Promise<void> {
    try {
      const services = this._orchestrationService.getSavedServices().filter(s => s.group === group);
      for (const svc of services) {
        this._orchestrationService.deleteService(svc.id);
      }
      this._sendOrchestrationData();
    } catch (error) {
      vscode.window.showErrorMessage('Failed to delete stack: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async _handleOrchAcceptDetection(detected: any): Promise<void> {
    try {
      // Generate default start commands based on framework
      let defaultCmds = this._getDefaultCommands(detected.framework, detected.role);
      // Fallback: try role if framework is missing
      if ((!defaultCmds || defaultCmds.length === 0) && detected.role) {
        defaultCmds = this._getDefaultCommands(undefined, detected.role);
      }
      this._orchestrationService.saveService({
        id: this._orchestrationService.generateId(),
        name: detected.name,
        port: detected.port,
        role: detected.role,
        startCommands: defaultCmds,
        workingDirectory: '.',
        autoDetected: true
      });
      this._sendOrchestrationData();
    } catch (error) {
      vscode.window.showErrorMessage('Failed to accept detected service: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private _getDefaultCommands(framework?: string, role?: string): string[] {
    const fw = (framework ?? '').toLowerCase();
    if (fw.includes('react') || fw.includes('next') || fw.includes('vite') || fw.includes('angular') || fw.includes('astro') || fw.includes('vue')) {
      return ['npm run dev'];
    }
    if (fw.includes('express') || fw.includes('nest') || fw.includes('graphql') || fw.includes('node')) {
      return ['npm run dev'];
    }
    if (fw.includes('django')) { return ['python manage.py runserver']; }
    if (fw.includes('uvicorn')) { return ['uvicorn main:app --reload']; }
    if (fw.includes('flask')) { return ['flask run']; }
    if (fw.includes('gunicorn')) { return ['gunicorn app:app']; }
    if (fw.includes('fastapi')) { return ['uvicorn main:app --reload']; }
    if (fw.includes('python')) { return ['python main.py']; }
    // Database start commands
    if (fw.includes('postgres')) { return ['pg_ctl start']; }
    if (fw.includes('mysql')) { return ['mysqld']; }
    if (fw.includes('mongodb') || fw.includes('mongod')) { return ['mongod']; }
    if (fw.includes('sql server')) { return ['sqlservr']; }
    // Cache start commands
    if (fw.includes('redis')) { return ['redis-server', 'memurai-cli']; }
    if (fw.includes('memcached')) { return ['memcached']; }
    // Fallback for role
    if (role === 'database') { return []; }
    if (role === 'cache') {
      if (fw.includes('redis')) { return ['redis-server']; }
      if (fw.includes('memcached')) { return ['memcached']; }
      return [];
    }
    return [];
  }

  // ─────────────────────────────────────────────
  // HTML — Single WebviewView with internal tabs
  // ─────────────────────────────────────────────

  private _getHtmlBody(): string {
    return /* html */ `

  <!-- HEADER -->
  <div class="header">
    <div class="title-bar">
      <span class="title-bar-name">PORT<span class="accent">VIZ</span></span>
      <div class="title-bar-actions">
        <button class="btn-icon" id="btn-refresh" title="Refresh">
          <svg class="icon-svg icon-fill" viewBox="0 0 24 24"><path d="M19.146 4.854l-1.489 1.489A8 8 0 1 0 12 20a8.094 8.094 0 0 0 7.371-4.886 1 1 0 1 0-1.842-.779A6.071 6.071 0 0 1 12 18a6 6 0 1 1 4.243-10.243l-1.39 1.39a.5.5 0 0 0 .354.854H19.5A.5.5 0 0 0 20 9.5V5.207a.5.5 0 0 0-.854-.353z"/></svg>
        </button>
      </div>
    </div>

    <!-- TAB BAR -->
    <div class="tab-bar" role="tablist" aria-label="Main navigation">
      <button class="tab-btn active" data-tab="overview" role="tab" aria-selected="true" aria-controls="tab-overview">Overview</button>
      <button class="tab-btn" data-tab="live" role="tab" aria-selected="false" aria-controls="tab-live">Live</button>
      <button class="tab-btn" data-tab="snapshots" role="tab" aria-selected="false" aria-controls="tab-snapshots">Snapshots</button>
      <button class="tab-btn" data-tab="orchestration" role="tab" aria-selected="false" aria-controls="tab-orchestration">Orch</button>
    </div>
  </div>

  <!-- TAB: OVERVIEW -->
  <div class="tab-content active" id="tab-overview" role="tabpanel" aria-labelledby="tab-overview">
    <div class="loading-state">Loading\u2026</div>
  </div>

  <!-- TAB: LIVE -->
  <div class="tab-content" id="tab-live" role="tabpanel" aria-labelledby="tab-live">
    <div class="live-controls">
      <div class="toggle-group">
        <label class="toggle-switch">
          <input type="checkbox" id="filter-hide-system" checked />
          <span class="toggle-slider"></span>
        </label>
        <label for="filter-hide-system">Hide System</label>
      </div>
      <div class="toggle-group">
        <label class="toggle-switch">
          <input type="checkbox" id="filter-public-only" />
          <span class="toggle-slider"></span>
        </label>
        <label for="filter-public-only">Public Only</label>
      </div>
      <div class="toggle-group">
        <label class="toggle-switch">
          <input type="checkbox" id="filter-show-udp" />
          <span class="toggle-slider"></span>
        </label>
        <label for="filter-show-udp">Show UDP</label>
      </div>
      <div class="controls-sep"></div>
      <div class="toggle-group">
        <label class="toggle-switch">
          <input type="checkbox" id="toggle-auto-refresh" />
          <span class="toggle-slider"></span>
        </label>
        <label for="toggle-auto-refresh">Auto Refresh</label>
      </div>
      <div class="controls-sep"></div>
      <div class="sort-group">
        <span class="sort-label">Sort by:</span>
        <select class="sort-select" id="sort-mode">
          <option value="name">Name</option>
          <option value="pid">PID</option>
          <option value="ports">Port Count</option>
        </select>
      </div>
    </div>
    <div id="live-content">
      <div class="loading-state">Loading\u2026</div>
    </div>
  </div>

  <!-- TAB: SNAPSHOTS -->
  <div class="tab-content" id="tab-snapshots" role="tabpanel" aria-labelledby="tab-snapshots">
    <div class="snap-action-bar">
      <button class="snap-btn" id="btn-save-snapshot"><svg class="snap-btn-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Save Snapshot</button>
    </div>
    <div id="snap-list-section">
      <div class="snap-empty">
        <div class="snap-empty-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div>
        <div class="snap-empty-title">No snapshots saved</div>
        <div class="snap-empty-desc">Capture your current port state and compare it later to detect changes. Click "Save snapshot" to start.</div>
        <button class="snap-cta" id="btn-save-snapshot-cta"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Capture Current State</button>
      </div>
    </div>
    <div class="snap-section" id="snap-compare-section" style="display:none;">
      <div class="snap-section-title">Compare</div>
      <div class="snap-compare">
        <div class="snap-compare-selects">
          <div class="snap-compare-row">
            <span class="snap-compare-label">A</span>
            <select class="snap-compare-select" id="snap-compare-a"></select>
          </div>
          <div class="snap-compare-row">
            <span class="snap-compare-label">B</span>
            <select class="snap-compare-select" id="snap-compare-b"></select>
          </div>
          <button class="snap-swap-btn" id="btn-snap-swap" title="Swap A and B">\u21C5</button>
        </div>
        <div class="snap-compare-actions">
          <button class="snap-compare-btn" id="btn-snap-compare"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> Compare</button>
          <button class="snap-compare-btn snap-compare-current-btn" id="btn-snap-compare-current">\u26A1 vs Current</button>
        </div>
        <div class="snap-compare-helper" id="snap-compare-helper"></div>
      </div>
    </div>
    <div id="snap-diff-results"></div>
  </div>

  <!-- TAB: ORCHESTRATION -->
  <div class="tab-content" id="tab-orchestration" role="tabpanel" aria-labelledby="tab-orchestration">
    <div class="orch-controls">
      <button class="orch-btn orch-btn-create" id="btn-orch-create">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Create
      </button>
      <button class="orch-btn orch-btn-detect" id="btn-orch-detect">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Detect
      </button>
    </div>
    <div class="orch-filter-bar">
      <input type="text" class="orch-filter-input" id="orch-filter" placeholder="Filter services by name, role, port…">
    </div>

    <div class="orch-section orch-section-detected" id="orch-detected-section">
      <div class="orch-section-title orch-section-toggle" id="orch-detected-toggle">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Detected Services
        <span class="orch-toggle-count" id="orch-detected-count"></span>
      </div>
      <div class="orch-collapsible-wrap">
        <div class="orch-list" id="orch-detected-list">
        <div class="orch-empty">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <div>No services detected</div>
          <div class="orch-empty-hint">Click "Detect" to scan running processes</div>
        </div>
      </div>
      </div>
    </div>

    <div class="orch-section orch-section-saved" id="orch-saved-section">
      <div class="orch-section-title orch-section-toggle" id="orch-saved-toggle">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        Saved Services
        <span class="orch-toggle-count" id="orch-saved-count"></span>
      </div>
      <div class="orch-collapsible-wrap">
      <div class="orch-list" id="orch-saved-list">
        <div class="orch-empty">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <div>No services saved</div>
          <div class="orch-empty-hint">Create or accept detected services to manage them</div>
        </div>
      </div>
      </div>
    </div>
  </div>

  <!-- Orchestration Modal -->
  <div class="orch-modal-overlay" id="orch-modal" role="dialog" aria-modal="true" aria-labelledby="orch-modal-title">
    <div class="orch-modal">
      <div class="orch-modal-header">
        <div class="orch-modal-title" id="orch-modal-title">Create Service</div>
        <button class="orch-modal-close" id="btn-orch-modal-close">&times;</button>
      </div>

      <div class="orch-modal-field">
        <label class="orch-modal-label">Name</label>
        <input type="text" class="orch-modal-input" id="orch-input-name" placeholder="e.g., My API Server">
      </div>

      <div class="orch-modal-field">
        <label class="orch-modal-label">Role</label>
        <input type="hidden" id="orch-input-role" value="">
        <div class="orch-dropdown" id="orch-role-dropdown" role="listbox" aria-label="Select role">
          <div class="orch-dropdown-selected" id="orch-role-selected" tabindex="0" role="button" aria-haspopup="listbox" aria-expanded="false">Select Role</div>
          <div class="orch-dropdown-list" id="orch-role-list" role="presentation">
            <div class="orch-dropdown-option" data-value="frontend" role="option">Frontend</div>
            <div class="orch-dropdown-option" data-value="backend" role="option">Backend</div>
            <div class="orch-dropdown-option" data-value="database" role="option">Database</div>
            <div class="orch-dropdown-option" data-value="cache" role="option">Cache</div>
            <div class="orch-dropdown-option" data-value="custom" role="option">Custom</div>
          </div>
        </div>
      </div>

      <div class="orch-modal-field">
        <label class="orch-modal-label">Working Directory</label>
        <input type="text" class="orch-modal-input" id="orch-input-cwd" placeholder=". (current directory)">
      </div>

      <div class="orch-modal-field">
        <label class="orch-modal-label">Start Commands (one per line)</label>
        <textarea class="orch-modal-textarea" id="orch-input-cmds" placeholder="npm install, npm start, etc."></textarea>
      </div>

      <div class="orch-modal-field">
        <label class="orch-modal-label">Environment Variables <span class="orch-modal-optional">(optional, KEY=VALUE per line)</span></label>
        <textarea class="orch-modal-textarea orch-modal-textarea-sm" id="orch-input-env" placeholder="NODE_ENV=development&#10;PORT=3000"></textarea>
      </div>

      <div class="orch-modal-field">
        <label class="orch-modal-label">Group / Stack <span class="orch-modal-optional">(optional, for bulk start)</span></label>
        <input type="text" class="orch-modal-input" id="orch-input-group" placeholder="e.g., my-fullstack">
      </div>

      <input type="hidden" id="orch-edit-id">

      <div class="orch-modal-actions">
        <button class="orch-modal-btn" id="btn-orch-modal-cancel">Cancel</button>
        <button class="orch-modal-btn primary" id="btn-orch-modal-save">Save</button>
      </div>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer" id="footer"></div>
    `;
  }

  private _getHtml(stylesUri: vscode.Uri, scriptUri: vscode.Uri): string {
    const nonce = this._getNonce();
    return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._view!.webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${this._view!.webview.cspSource};" />
  <title>Portviz</title>
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
${this._getHtmlBody()}
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
    `;
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
