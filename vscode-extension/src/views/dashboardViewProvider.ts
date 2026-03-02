import * as vscode from 'vscode';
import { CliRunner } from '../services/cliRunner';
import { SnapshotService } from '../services/snapshotService';
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

  private _view?: vscode.WebviewView;
  private _rawData: PortEntry[] = [];
  private _filters: FilterState = { hideSystem: true, publicOnly: false, showUdp: false };
  private _sortMode: SortMode = 'name';
  private _autoRefreshInterval?: ReturnType<typeof setInterval>;
  private _previousPids: Set<number> = new Set();
  private _isRefreshing = false;
  private readonly _snapshotService: SnapshotService;

  constructor(private readonly _extensionUri: vscode.Uri, globalState: vscode.Memento) {
    this._snapshotService = new SnapshotService(globalState);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtml();

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
        case 'snapshotList':
          this._sendSnapshotList();
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this._clearAutoRefresh();
    });

    this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this._isRefreshing) { return; }
    this._isRefreshing = true;

    this._view?.webview.postMessage({ type: 'loadingStart' });

    const runner = new CliRunner();
    const result = await runner.runReport();

    this._isRefreshing = false;
    this._view?.webview.postMessage({ type: 'loadingEnd' });

    if (!result.success || !result.data) {
      vscode.window.showErrorMessage(result.error ?? 'Failed to load Portviz data');
      return;
    }

    this._rawData = result.data;
    this._sendFilteredData();
    this._sendOverviewData();
    this._sendSnapshotList();
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

    this._view.webview.postMessage({
      type: 'liveUpdate',
      data: groups,
      newPids,
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
      this._autoRefreshInterval = setInterval(() => { this.refresh(); }, 5000);
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

  // ─────────────────────────────────────────────
  // HTML — Single WebviewView with internal tabs
  // ─────────────────────────────────────────────

  private _getHtml(): string {
    return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portviz</title>
  <style>
    /* ── RESET ── */
    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      height: 100%;
      overflow: hidden;
    }

    body {
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      font-size: calc(var(--vscode-font-size, 13px) + 1px);
      color: var(--vscode-editor-foreground);
      background: transparent;
      display: flex;
      flex-direction: column;
      line-height: 1.5;
    }

    /* ── TOP HEADER ── */
    .header {
      flex-shrink: 0;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      z-index: 10;
    }

    .title-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    }

    .title-bar-name {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 2px;
    }

    .title-bar-name .accent { color: #4fc3f7; }

    .title-bar-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* ── TAB BAR ── */
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .tab-btn {
      flex: 1;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 7px 0;
      cursor: pointer;
      text-align: center;
      transition: color 0.15s, border-color 0.15s;
    }

    .tab-btn:hover {
      color: var(--vscode-editor-foreground);
    }

    .tab-btn.active {
      color: #4fc3f7;
      border-bottom-color: #4fc3f7;
    }

    /* ── TAB CONTENT ── */
    .tab-content {
      flex: 1;
      overflow-y: scroll;
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    /* ── FOOTER ── */
    .footer {
      flex-shrink: 0;
      padding: 6px 14px;
      border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      font-size: 11px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    /* ── SHARED BUTTON STYLES ── */
    .btn-icon {
      background: none;
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
      color: var(--vscode-editor-foreground);
      cursor: pointer;
      border-radius: 4px;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, opacity 0.15s;
    }

    .btn-icon:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
    }

    .btn-icon:disabled { opacity: 0.4; cursor: not-allowed; }

    .btn-icon.spinning { animation: spin 0.8s linear infinite; }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .icon-svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      pointer-events: none;
    }

    .icon-svg.icon-fill {
      fill: currentColor;
      stroke: none;
    }

    .btn-icon .icon-svg {
      width: 15px;
      height: 15px;
    }

    /* ════════════════════════════════════
       OVERVIEW TAB
       ════════════════════════════════════ */

    .ov-section {
      margin-bottom: 18px;
      padding: 0 14px;
    }

    .ov-section:first-child {
      padding-top: 12px;
    }

    .ov-section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      margin-bottom: 10px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    }

    .ov-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .ov-card {
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      background: var(--vscode-input-background, rgba(255,255,255,0.04));
    }

    .ov-card.full { grid-column: 1 / -1; }

    .ov-val {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.2;
    }

    .ov-lbl {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      margin-top: 2px;
    }

    .ov-val.green  { color: #66bb6a; }
    .ov-val.blue   { color: #42a5f5; }
    .ov-val.orange { color: #ffa726; }
    .ov-val.purple { color: #ab47bc; }

    /* Card hierarchy */
    .ov-card.primary .ov-val { font-size: 24px; }
    .ov-card.secondary .ov-val { font-size: 22px; font-weight: 700; }
    .ov-card.tertiary .ov-val { font-size: 18px; opacity: 0.8; }
    .ov-card.tertiary .ov-lbl { opacity: 0.7; }

    .ov-card.full .ov-val {
      font-size: 12px;
      font-weight: 400;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
    }

    .ov-risk-empty {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
      padding: 8px 0;
    }

    .ov-risk-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.05));
    }

    .ov-risk-item:last-child { border-bottom: none; }

    .ov-risk-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .ov-risk-dot.severity-high   { background: #ef5350; }
    .ov-risk-dot.severity-medium { background: #ffa726; }
    .ov-risk-dot.severity-low    { background: #66bb6a; }

    .ov-risk-info { flex: 1; min-width: 0; }

    .ov-risk-name {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ov-risk-detail {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
    }

    .ov-risk-badge {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
      flex-shrink: 0;
    }

    /* ════════════════════════════════════
       LIVE TAB
       ════════════════════════════════════ */

    .live-controls {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      flex-wrap: wrap;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      position: sticky;
      top: 0;
      z-index: 5;
    }

    .toggle-group {
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      cursor: pointer;
    }

    .toggle-group label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.6));
      cursor: pointer;
    }

    .toggle-switch {
      position: relative;
      display: block;
      width: 32px;
      height: 16px;
      cursor: pointer;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }

    .toggle-slider {
      position: absolute;
      inset: 0;
      background: var(--vscode-input-background, rgba(255,255,255,0.08));
      border-radius: 8px;
      transition: background 0.2s;
      cursor: pointer;
    }

    .toggle-slider::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      background: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
      border-radius: 50%;
      transition: transform 0.2s, background 0.2s;
    }

    .toggle-switch input:checked + .toggle-slider {
      background: #4fc3f7;
    }

    .toggle-switch input:checked + .toggle-slider::after {
      transform: translateX(16px);
      background: #fff;
    }

    .controls-sep {
      width: 1px;
      height: 16px;
      background: var(--vscode-panel-border, rgba(255,255,255,0.1));
      flex-shrink: 0;
    }

    .sort-select {
      font-family: inherit;
      font-size: 11px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-input-background, rgba(255,255,255,0.06));
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      outline: none;
    }

    .sort-select:focus { border-color: #4fc3f7; }

    .sort-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.6));
    }

    /* Process rows */
    .process-row {
      padding: 6px 14px;
      cursor: pointer;
      user-select: none;
    }

    .process-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .process-chevron {
      font-size: 10px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
      transition: transform 0.15s;
      width: 14px;
      text-align: center;
      flex-shrink: 0;
    }

    .process-chevron.open { transform: rotate(90deg); }

    .process-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .process-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    .process-name {
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .process-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      opacity: 0.75;
    }

    .process-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    /* Port rows */
    .port-list {
      padding-left: 30px;
      overflow: hidden;
      max-height: 2000px;
      transition: max-height 0.15s ease;
    }

    .port-row {
      display: flex;
      align-items: center;
      padding: 3px 0;
      border-radius: 4px;
    }

    .port-row:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    }

    .port-left {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      min-width: 0;
    }

    .port-icon {
      font-size: 12px;
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }

    .port-number {
      font-weight: 700;
      font-size: 13px;
      min-width: 45px;
    }

    .port-detail {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      white-space: nowrap;
    }

    .badge-public {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(255, 167, 38, 0.12);
      color: #ffa726;
      border: 1px solid rgba(255, 167, 38, 0.25);
      white-space: nowrap;
    }

    .badge-framework {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(66, 165, 245, 0.12);
      color: #42a5f5;
      border: 1px solid rgba(66, 165, 245, 0.2);
      white-space: nowrap;
    }

    .port-right {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    /* Action buttons */
    .btn-action {
      background: none;
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
      color: var(--vscode-editor-foreground);
      cursor: pointer;
      border-radius: 4px;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      flex-shrink: 0;
    }

    .btn-action:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
    }

    .btn-action.open-btn:hover { border-color: #4fc3f7; color: #4fc3f7; }
    .btn-action.kill-btn:hover { border-color: #ef5350; color: #ef5350; }

    /* Semantic colors */
    .dot-green  { background: #66bb6a; }
    .dot-orange { background: #ffa726; }
    .dot-purple { background: #ab47bc; }
    .dot-gray   { background: #9e9e9e; }

    .port-local  { color: #66bb6a; }
    .port-public { color: #ffa726; }
    .port-udp    { color: #ab47bc; }
    .port-other  { color: #42a5f5; }

    /* States */
    .empty-state, .loading-state {
      text-align: center;
      padding: 40px 14px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
    }

    .empty-state .icon { font-size: 32px; margin-bottom: 8px; }

    .process-row.highlight {
      background: rgba(79, 195, 247, 0.08);
      transition: background 1.5s ease-out;
    }

    .process-row.highlight-fade { background: transparent; }

    /* ════════════════════════════════════
       SNAPSHOTS TAB
       ════════════════════════════════════ */

    .snap-section {
      padding: 0 14px;
      margin-bottom: 16px;
    }

    .snap-section:first-child { padding-top: 10px; }

    .snap-action-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      position: sticky;
      top: 0;
      z-index: 5;
    }

    .snap-btn {
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 4px;
      border: 1px solid #4fc3f7;
      background: rgba(79, 195, 247, 0.1);
      color: #4fc3f7;
      cursor: pointer;
      transition: background 0.15s;
    }

    .snap-btn:hover { background: rgba(79, 195, 247, 0.2); }

    .snap-section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    }

    .snap-table {
      width: 100%;
    }

    .snap-table-header {
      display: grid;
      grid-template-columns: 1fr 55px 80px 24px;
      gap: 4px;
      padding: 4px 0;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.06));
    }

    .snap-row {
      display: grid;
      grid-template-columns: 1fr 55px 80px 24px;
      gap: 4px;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.04));
      font-size: 12px;
    }

    .snap-row:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
      border-radius: 4px;
    }

    .snap-row { cursor: pointer; position: relative; }

    /* Snapshot detail (expanded view) */
    .snap-detail {
      grid-column: 1 / -1;
      padding: 6px 0 8px 14px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.06));
    }

    .snap-detail-proc {
      margin-bottom: 4px;
    }

    .snap-detail-proc-name {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
      margin-bottom: 2px;
    }

    .snap-detail-proc-meta {
      font-size: 10px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
    }

    .snap-detail-port {
      font-size: 11px;
      padding: 1px 0 1px 12px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
    }

    .snap-detail-port .port-num {
      color: #42a5f5;
      font-weight: 600;
    }

    .snap-detail-port .port-pub {
      color: #ffa726;
    }

    /* Empty state */
    .snap-empty {
      text-align: center;
      padding: 30px 14px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
    }

    .snap-empty-icon { font-size: 28px; margin-bottom: 8px; }

    .snap-empty-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
      margin-bottom: 4px;
    }

    .snap-empty-desc {
      font-size: 11px;
      max-width: 220px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .snap-name-cell {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .snap-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .snap-dot.green  { background: #66bb6a; }
    .snap-dot.blue   { background: #42a5f5; }
    .snap-dot.orange { background: #ffa726; }
    .snap-dot.purple { background: #ab47bc; }

    .snap-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 600;
    }

    .snap-ports { text-align: center; color: #42a5f5; font-weight: 600; }

    .snap-date {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      text-align: right;
    }

    .snap-menu-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
      cursor: pointer;
      font-size: 14px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      width: 24px;
      height: 24px;
      transition: background 0.15s, color 0.15s;
    }

    .snap-menu-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
      color: var(--vscode-editor-foreground);
    }

    .snap-dropdown {
      position: absolute;
      right: 14px;
      background: var(--vscode-menu-background, #252526);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 20;
      min-width: 120px;
      overflow: hidden;
    }

    .snap-dropdown-item {
      padding: 6px 14px;
      font-size: 12px;
      cursor: pointer;
      color: var(--vscode-editor-foreground);
      transition: background 0.1s;
    }

    .snap-dropdown-item:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
    }

    .snap-dropdown-item.danger { color: #ef5350; }

    /* Compare section */
    .snap-compare {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .snap-compare-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .snap-compare-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      width: 14px;
      flex-shrink: 0;
    }

    .snap-compare-select {
      flex: 1;
      font-family: inherit;
      font-size: 11px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-input-background, rgba(255,255,255,0.06));
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
      border-radius: 4px;
      padding: 4px 6px;
      outline: none;
    }

    .snap-compare-select:focus { border-color: #4fc3f7; }

    .snap-compare-btn {
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 14px;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
      background: var(--vscode-input-background, rgba(255,255,255,0.06));
      color: var(--vscode-editor-foreground);
      cursor: pointer;
      align-self: flex-start;
      transition: background 0.15s, border-color 0.15s;
    }

    .snap-compare-btn:hover { border-color: #4fc3f7; background: rgba(79, 195, 247, 0.1); }

    /* Diff results */
    .snap-diff {
      margin-top: 8px;
    }

    .snap-diff-summary {
      display: flex;
      gap: 12px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .snap-diff-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
    }

    .snap-diff-badge.added  { background: rgba(102,187,106,0.15); color: #66bb6a; }
    .snap-diff-badge.removed { background: rgba(239,83,80,0.15); color: #ef5350; }
    .snap-diff-badge.same   { background: rgba(255,255,255,0.06); color: var(--vscode-descriptionForeground); }

    .snap-diff-list {
      font-size: 11px;
      margin-bottom: 6px;
    }

    .snap-diff-item {
      padding: 2px 0;
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .snap-diff-item.added { color: #66bb6a; }
    .snap-diff-item.removed { color: #ef5350; }

    /* ════════════════════════════════════
       PLACEHOLDER TABS (Orchestration)
       ════════════════════════════════════ */

    .placeholder-page {
      text-align: center;
      padding: 40px 14px;
    }

    .placeholder-page .ph-icon {
      font-size: 28px;
      margin-bottom: 10px;
    }

    .placeholder-page .ph-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .placeholder-page .ph-desc {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      max-width: 240px;
      margin: 0 auto 16px;
    }

    .ph-btn-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
    }

    .ph-btn {
      font-family: inherit;
      font-size: 12px;
      padding: 6px 16px;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
      background: var(--vscode-input-background, rgba(255,255,255,0.06));
      color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
      cursor: not-allowed;
      width: 180px;
      text-align: center;
    }
  </style>
</head>
<body>

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
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="live">Live</button>
      <button class="tab-btn" data-tab="snapshots">Snapshots</button>
      <button class="tab-btn" data-tab="orchestration">Orch</button>
    </div>
  </div>

  <!-- TAB: OVERVIEW -->
  <div class="tab-content active" id="tab-overview">
    <div class="loading-state">Loading\u2026</div>
  </div>

  <!-- TAB: LIVE -->
  <div class="tab-content" id="tab-live">
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
        <label for="toggle-auto-refresh">Auto Refresh (5s)</label>
      </div>
      <div class="controls-sep"></div>
      <span class="sort-label">Sort by:</span>
      <select class="sort-select" id="sort-mode">
        <option value="name">Name</option>
        <option value="pid">PID</option>
        <option value="ports">Port Count</option>
      </select>
    </div>
    <div id="live-content">
      <div class="loading-state">Loading\u2026</div>
    </div>
  </div>

  <!-- TAB: SNAPSHOTS -->
  <div class="tab-content" id="tab-snapshots">
    <div class="snap-action-bar">
      <button class="snap-btn" id="btn-save-snapshot">\u{2795} Save Snapshot</button>
    </div>
    <div id="snap-list-section">
      <div class="snap-empty">
        <div class="snap-empty-icon">\u{1F4F8}</div>
        <div class="snap-empty-title">No Snapshots Yet</div>
        <div class="snap-empty-desc">Capture your current port state and compare it later to detect changes. Click "Save Snapshot" to start.</div>
      </div>
    </div>
    <div class="snap-section" id="snap-compare-section" style="display:none;">
      <div class="snap-section-title">Compare</div>
      <div class="snap-compare">
        <div class="snap-compare-row">
          <span class="snap-compare-label">A</span>
          <select class="snap-compare-select" id="snap-compare-a"></select>
        </div>
        <div class="snap-compare-row">
          <span class="snap-compare-label">B</span>
          <select class="snap-compare-select" id="snap-compare-b"></select>
        </div>
        <button class="snap-compare-btn" id="btn-snap-compare">\u{1F50D} Compare</button>
      </div>
      <div id="snap-diff-results"></div>
    </div>
  </div>

  <!-- TAB: ORCHESTRATION -->
  <div class="tab-content" id="tab-orchestration">
    <div class="placeholder-page">
      <div class="ph-icon">\u{2699}\u{FE0F}</div>
      <div class="ph-title">Orchestration</div>
      <div class="ph-desc">Manage multiple processes at once. Multi-select, batch kill, and process grouping coming soon.</div>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer" id="footer"></div>

  <script>
    const vscode = acquireVsCodeApi();

    // ── Tab switching ──
    let activeTab = 'overview';
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + activeTab).classList.add('active');
      });
    });

    // ── Refresh button ──
    document.getElementById('btn-refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    // ── Filter toggles ──
    document.getElementById('filter-hide-system').addEventListener('change', sendFilters);
    document.getElementById('filter-public-only').addEventListener('change', sendFilters);
    document.getElementById('filter-show-udp').addEventListener('change', sendFilters);

    function sendFilters() {
      vscode.postMessage({
        type: 'filterChange',
        filters: {
          hideSystem: document.getElementById('filter-hide-system').checked,
          publicOnly: document.getElementById('filter-public-only').checked,
          showUdp: document.getElementById('filter-show-udp').checked
        }
      });
    }

    document.getElementById('sort-mode').addEventListener('change', (e) => {
      vscode.postMessage({ type: 'sortChange', sort: e.target.value });
    });

    document.getElementById('toggle-auto-refresh').addEventListener('change', (e) => {
      vscode.postMessage({ type: 'autoRefreshChange', enabled: e.target.checked });
    });

    // ── Semantic colors ──
    function getProcessDotClass(proc) {
      const name = proc.name.toLowerCase();
      if (name.includes('system') || proc.pid === 0 || proc.pid === 4) return 'dot-gray';
      if (proc.ports.some(p => p.local_ip === '0.0.0.0')) return 'dot-orange';
      if (proc.ports.every(p => p.protocol === 'UDP')) return 'dot-purple';
      return 'dot-green';
    }

    function getPortColorClass(port) {
      if (port.protocol === 'UDP') return 'port-udp';
      if (port.local_ip === '0.0.0.0') return 'port-public';
      if (port.local_ip === '127.0.0.1' || port.local_ip === '::1') return 'port-local';
      return 'port-other';
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // ── LIVE state ──
    let expandedPids = new Set();
    let currentLiveData = [];
    let newPidSet = new Set();

    function renderLive(data) {
      currentLiveData = data;
      const el = document.getElementById('live-content');

      if (!data || data.length === 0) {
        el.innerHTML = '<div class="empty-state"><div class="icon">\u{1F4E1}</div><div>No listening ports found</div></div>';
        return;
      }

      let html = '';
      data.forEach((proc) => {
        const dotClass = getProcessDotClass(proc);
        const isOpen = expandedPids.has(proc.pid);
        const portCount = proc.ports.length;
        const isNew = newPidSet.has(proc.pid);

        html += '<div class="process-row' + (isNew ? ' highlight' : '') + '" data-row-pid="' + proc.pid + '">';
        html += '<div class="process-header" data-pid="' + proc.pid + '">';
        html += '<span class="process-chevron ' + (isOpen ? 'open' : '') + '">\u25B6</span>';
        html += '<span class="process-dot ' + dotClass + '"></span>';
        html += '<div class="process-info">';
        html += '<span class="process-name">' + escapeHtml(proc.name) + '</span>';
        html += '<span class="process-meta">' + portCount + ' port' + (portCount !== 1 ? 's' : '') + ' \u00B7 PID ' + proc.pid + '</span>';
        html += '</div>';
        html += '<div class="process-actions">';
        html += '<button class="btn-action kill-btn" data-kill-pid="' + proc.pid + '" data-kill-name="' + escapeHtml(proc.name) + '" data-kill-ports="' + portCount + '" title="Kill Process"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M3 6H21"/><path d="M8 6V4C8 3.448 8.448 3 9 3H15C15.552 3 16 3.448 16 4V6"/><path d="M19 6L18.2 19C18.138 19.877 17.406 20.5 16.526 20.5H7.474C6.594 20.5 5.862 19.877 5.8 19L5 6"/><path d="M10 11V17"/><path d="M14 11V17"/></svg></button>';
        html += '</div>';
        html += '</div>';

        if (isOpen) {
          html += '<div class="port-list">';
          proc.ports.forEach(port => {
            const isPublic = port.local_ip === '0.0.0.0';
            const address = isPublic ? '0.0.0.0' : 'Localhost';
            const pColor = getPortColorClass(port);
            html += '<div class="port-row">';
            html += '<div class="port-left">';
            html += '<span class="port-icon">\u{1F4E6}</span>';
            html += '<span class="port-number ' + pColor + '">' + port.local_port + '</span>';
            html += '<span class="port-detail">\u00B7 ' + address + ' \u00B7 ' + port.protocol + '</span>';
            if (isPublic) { html += '<span class="badge-public">\u{1F310} Public</span>'; }
            if (port.frameworkHint) { html += '<span class="badge-framework">' + escapeHtml(port.frameworkHint) + '</span>'; }
            html += '</div>';
            html += '<div class="port-right">';
            if (port.protocol === 'TCP') {
              html += '<button class="btn-action open-btn" data-open-port="' + port.local_port + '" data-open-ip="' + port.local_ip + '" title="Open in Browser"><svg class="icon-svg icon-fill" viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h5V3H3v7h2V5zm0 14h14V9h2v12H3V9h2v10z"/></svg></button>';
            }
            html += '</div>';
            html += '</div>';
          });
          html += '</div>';
        }

        html += '</div>';
      });

      el.innerHTML = html;
      bindLiveEvents();

      if (newPidSet.size > 0) {
        setTimeout(() => {
          document.querySelectorAll('.process-row.highlight').forEach(el => {
            el.classList.add('highlight-fade');
            el.classList.remove('highlight');
          });
          newPidSet.clear();
        }, 1500);
      }
    }

    function bindLiveEvents() {
      document.querySelectorAll('.process-header').forEach(el => {
        el.addEventListener('click', () => {
          const pid = Number(el.dataset.pid);
          if (expandedPids.has(pid)) { expandedPids.delete(pid); }
          else { expandedPids.add(pid); }
          renderLive(currentLiveData);
        });
      });

      document.querySelectorAll('[data-kill-pid]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'kill',
            pid: Number(el.dataset.killPid),
            processName: el.dataset.killName,
            portCount: Number(el.dataset.killPorts)
          });
        });
      });

      document.querySelectorAll('[data-open-port]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'open',
            port: Number(el.dataset.openPort),
            ip: el.dataset.openIp
          });
        });
      });
    }

    // ── OVERVIEW render ──
    function renderOverview(data) {
      const el = document.getElementById('tab-overview');
      if (!data) {
        el.innerHTML = '<div class="loading-state">No data available</div>';
        return;
      }

      let html = '';

      html += '<div class="ov-section">';
      html += '<div class="ov-section-title">Summary</div>';
      html += '<div class="ov-grid">';
      html += ovCard(data.listeningPorts, 'Listening Ports', 'blue', 'primary');
      html += ovCard(data.publicPorts, 'Public Ports', 'orange', 'secondary');
      html += ovCard(data.totalProcesses, 'Processes', 'green', 'tertiary');
      html += ovCard(data.udpPorts, 'UDP Ports', 'purple', 'tertiary');
      html += '<div class="ov-card full"><div class="ov-val">Last updated: ' + data.lastUpdated + '</div></div>';
      html += '</div></div>';

      html += '<div class="ov-section">';
      html += '<div class="ov-section-title">Risk Insight \u2014 Public Services</div>';
      if (data.riskServices.length === 0) {
        html += '<div class="ov-risk-empty">\u2705 No publicly exposed services</div>';
      } else {
        data.riskServices.forEach(svc => {
          const ports = svc.ports.join(', ');
          const sevClass = 'severity-' + svc.severity;
          const sevLabel = svc.severity === 'high' ? 'HIGH' : svc.severity === 'medium' ? 'MED' : 'LOW';
          html += '<div class="ov-risk-item">';
          html += '<span class="ov-risk-dot ' + sevClass + '"></span>';
          html += '<div class="ov-risk-info">';
          html += '<div class="ov-risk-name">' + escapeHtml(svc.name) + '</div>';
          html += '<div class="ov-risk-detail">PID ' + svc.pid + ' \u00B7 Ports: ' + ports + '</div>';
          html += '</div>';
          html += '<span class="ov-risk-badge">' + sevLabel + '</span>';
          html += '</div>';
        });
      }
      html += '</div>';

      el.innerHTML = html;
    }

    function ovCard(value, label, cls, tier) {
      return '<div class="ov-card ' + (tier || '') + '"><div class="ov-val ' + cls + '">' + value + '</div><div class="ov-lbl">' + label + '</div></div>';
    }

    // ── Footer ──
    function updateFooter(summary) {
      const footer = document.getElementById('footer');
      if (!summary) { footer.textContent = ''; return; }
      const parts = [];
      parts.push(summary.processes + ' process' + (summary.processes !== 1 ? 'es' : ''));
      parts.push(summary.ports + ' listening port' + (summary.ports !== 1 ? 's' : ''));
      if (summary.publicPorts > 0) { parts.push(summary.publicPorts + ' public'); }
      footer.textContent = parts.join(' \u2022 ');
    }

    // ════════════════════════════════
    // SNAPSHOT TAB LOGIC
    // ════════════════════════════════

    let snapshotData = [];
    let activeDropdownId = null;

    // Save button
    document.getElementById('btn-save-snapshot').addEventListener('click', () => {
      vscode.postMessage({ type: 'snapshotSave' });
    });

    // Compare button
    document.getElementById('btn-snap-compare').addEventListener('click', () => {
      const idA = document.getElementById('snap-compare-a').value;
      const idB = document.getElementById('snap-compare-b').value;
      if (!idA || !idB) { return; }
      if (idA === idB) { return; }
      vscode.postMessage({ type: 'snapshotCompare', idA, idB });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
      closeDropdowns();
    });

    function closeDropdowns() {
      document.querySelectorAll('.snap-dropdown').forEach(d => d.remove());
      activeDropdownId = null;
    }

    function timeAgo(isoStr) {
      const diff = Date.now() - new Date(isoStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + ' min ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      const days = Math.floor(hrs / 24);
      if (days < 30) return days + 'd ago';
      return new Date(isoStr).toLocaleDateString();
    }

    function getSnapDotColor(index) {
      const colors = ['green', 'blue', 'orange', 'purple'];
      return colors[index % colors.length];
    }

    let expandedSnapId = null;

    function renderSnapshots(data) {
      snapshotData = data;
      const el = document.getElementById('snap-list-section');
      const compareSection = document.getElementById('snap-compare-section');

      if (!data || data.length === 0) {
        el.innerHTML = '<div class="snap-empty"><div class="snap-empty-icon">\u{1F4F8}</div><div class="snap-empty-title">No Snapshots Yet</div><div class="snap-empty-desc">Capture your current port state and compare it later to detect changes. Click \u201CSave Snapshot\u201D to start.</div></div>';
        compareSection.style.display = 'none';
        return;
      }

      let html = '<div class="snap-section">';
      html += '<div class="snap-section-title">Saved Snapshots (' + data.length + ')</div>';
      html += '<div class="snap-table">';
      html += '<div class="snap-table-header"><span>Name</span><span style="text-align:center">Procs</span><span style="text-align:right">Date</span><span></span></div>';

      data.forEach((snap, i) => {
        const isExpanded = expandedSnapId === snap.id;
        html += '<div class="snap-row" data-snap-id="' + snap.id + '">';
        html += '<div class="snap-name-cell"><span class="snap-dot ' + getSnapDotColor(i) + '"></span><span class="snap-name">' + escapeHtml(snap.name) + '</span></div>';
        html += '<span class="snap-ports">' + snap.processCount + '</span>';
        html += '<span class="snap-date">' + timeAgo(snap.createdAt) + '</span>';
        html += '<button class="snap-menu-btn" data-snap-menu="' + snap.id + '" title="More actions">\u22EE</button>';
        html += '</div>';

        if (isExpanded && snap.processes) {
          html += '<div class="snap-detail">';
          snap.processes.forEach(proc => {
            html += '<div class="snap-detail-proc">';
            html += '<div class="snap-detail-proc-name">' + escapeHtml(proc.name) + ' <span class="snap-detail-proc-meta">PID ' + proc.pid + ' \u00B7 ' + proc.ports.length + ' port' + (proc.ports.length !== 1 ? 's' : '') + '</span></div>';
            proc.ports.forEach(p => {
              const cls = p.ip === '0.0.0.0' ? 'port-pub' : 'port-num';
              html += '<div class="snap-detail-port"><span class="' + cls + '">:' + p.port + '</span> ' + p.ip + '</div>';
            });
            html += '</div>';
          });
          html += '</div>';
        }
      });

      html += '</div></div>';
      el.innerHTML = html;

      // Show compare section if 2+ snapshots
      if (data.length >= 2) {
        compareSection.style.display = '';
        populateCompareSelects(data);
      } else {
        compareSection.style.display = 'none';
      }

      // Bind row click to expand/collapse
      document.querySelectorAll('.snap-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.snap-menu-btn')) return;
          const id = row.dataset.snapId;
          expandedSnapId = expandedSnapId === id ? null : id;
          renderSnapshots(snapshotData);
        });
      });

      // Bind menu buttons
      document.querySelectorAll('[data-snap-menu]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.snapMenu;
          if (activeDropdownId === id) { closeDropdowns(); return; }
          closeDropdowns();
          showSnapDropdown(btn, id);
        });
      });
    }

    function showSnapDropdown(anchor, id) {
      activeDropdownId = id;
      const dd = document.createElement('div');
      dd.className = 'snap-dropdown';

      const rect = anchor.getBoundingClientRect();
      dd.style.top = (rect.bottom + 2) + 'px';

      dd.innerHTML = '<div class="snap-dropdown-item" data-action="rename">Rename</div><div class="snap-dropdown-item danger" data-action="delete">Delete</div>';

      dd.querySelector('[data-action="rename"]').addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdowns();
        vscode.postMessage({ type: 'snapshotRename', id });
      });

      dd.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdowns();
        vscode.postMessage({ type: 'snapshotDelete', id });
      });

      document.body.appendChild(dd);
    }

    function populateCompareSelects(data) {
      const selA = document.getElementById('snap-compare-a');
      const selB = document.getElementById('snap-compare-b');
      const prevA = selA.value;
      const prevB = selB.value;

      selA.innerHTML = '';
      selB.innerHTML = '';

      data.forEach(snap => {
        const optA = document.createElement('option');
        optA.value = snap.id;
        optA.textContent = snap.name;
        selA.appendChild(optA);

        const optB = document.createElement('option');
        optB.value = snap.id;
        optB.textContent = snap.name;
        selB.appendChild(optB);
      });

      // Restore previous selection or default to first two
      if (prevA && data.some(s => s.id === prevA)) { selA.value = prevA; }
      if (prevB && data.some(s => s.id === prevB)) { selB.value = prevB; }
      else if (data.length >= 2) { selB.value = data[1].id; }
    }

    function renderDiff(diff) {
      const el = document.getElementById('snap-diff-results');
      if (!diff) { el.innerHTML = ''; return; }

      let html = '<div class="snap-diff">';

      // Summary badges
      html += '<div class="snap-diff-summary">';
      html += '<span class="snap-diff-badge added">+' + diff.addedPorts.length + ' new</span>';
      html += '<span class="snap-diff-badge removed">-' + diff.removedPorts.length + ' removed</span>';
      html += '<span class="snap-diff-badge same">' + diff.unchangedPorts + ' unchanged</span>';
      html += '</div>';

      // Added ports
      if (diff.addedPorts.length > 0) {
        html += '<div class="snap-diff-list">';
        diff.addedPorts.forEach(p => {
          html += '<div class="snap-diff-item added">\u002B :' + p.port + ' (' + escapeHtml(p.process) + ') ' + p.protocol + '</div>';
        });
        html += '</div>';
      }

      // Removed ports
      if (diff.removedPorts.length > 0) {
        html += '<div class="snap-diff-list">';
        diff.removedPorts.forEach(p => {
          html += '<div class="snap-diff-item removed">\u2212 :' + p.port + ' (' + escapeHtml(p.process) + ') ' + p.protocol + '</div>';
        });
        html += '</div>';
      }

      if (diff.addedPorts.length === 0 && diff.removedPorts.length === 0) {
        html += '<div style="font-size:12px;color:var(--vscode-descriptionForeground);padding:4px 0;">\u2705 Snapshots are identical</div>';
      }

      html += '</div>';
      el.innerHTML = html;
    }

    // Request snapshot list on tab switch to snapshots
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'snapshots') {
          vscode.postMessage({ type: 'snapshotList' });
        }
      });
    });

    // ── Message handler ──
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'liveUpdate':
          newPidSet = new Set(msg.newPids || []);
          renderLive(msg.data);
          updateFooter(msg.summary);
          break;

        case 'overviewUpdate':
          renderOverview(msg.data);
          break;

        case 'snapshotListUpdate':
          renderSnapshots(msg.data);
          break;

        case 'snapshotDiff':
          renderDiff(msg.data);
          break;

        case 'loadingStart': {
          const btn = document.getElementById('btn-refresh');
          btn.disabled = true;
          btn.classList.add('spinning');
          break;
        }

        case 'loadingEnd': {
          const btn = document.getElementById('btn-refresh');
          btn.disabled = false;
          btn.classList.remove('spinning');
          break;
        }
      }
    });
  </script>
</body>
</html>
    `;
  }
}
