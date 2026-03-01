import * as vscode from 'vscode';
import { CliRunner } from '../services/cliRunner';
import { PortEntry } from '../types/report';

interface ProcessGroup {
  name: string;
  pid: number;
  ports: PortEntry[];
}

interface FilterState {
  hideSystem: boolean;
  publicOnly: boolean;
  showUdp: boolean;
}

type SortMode = 'name' | 'pid' | 'ports';

export class DashboardViewProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'portviz.dashboard';

  private _view?: vscode.WebviewView;
  private _rawData: PortEntry[] = [];
  private _filters: FilterState = { hideSystem: true, publicOnly: false, showUdp: false };
  private _sortMode: SortMode = 'name';
  private _autoRefreshInterval?: ReturnType<typeof setInterval>;
  private _previousPids: Set<number> = new Set();
  private _isRefreshing = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

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

    // Handle messages from webview
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
      }
    });

    // Clean up auto-refresh when view is disposed
    webviewView.onDidDispose(() => {
      this._clearAutoRefresh();
    });

    // Auto-load on view open
    this.refresh();
  }

  /** Fetch data from CLI and push to webview */
  public async refresh(): Promise<void> {
    if (this._isRefreshing) { return; }
    this._isRefreshing = true;

    // Signal loading state to webview
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
  }

  /** Apply filters, sort, and send grouped data to webview */
  private _sendFilteredData(): void {
    if (!this._view) { return; }

    let filtered = [...this._rawData];

    // Base filter: only LISTENING + TCP (unless showUdp)
    filtered = filtered.filter(p => {
      if (p.protocol === 'UDP') {
        return this._filters.showUdp;
      }
      return p.protocol === 'TCP' && p.state === 'LISTENING';
    });

    // Hide System
    if (this._filters.hideSystem) {
      filtered = filtered.filter(p => {
        const name = (p.process_name ?? '').toLowerCase();
        return !name.includes('system') && p.pid !== 0 && p.pid !== 4;
      });
    }

    // Public Only
    if (this._filters.publicOnly) {
      filtered = filtered.filter(p => p.local_ip === '0.0.0.0');
    }

    // Group by process
    const groups = this._groupByProcess(filtered);

    // Sort
    this._sortGroups(groups);

    // Detect new PIDs
    const currentPids = new Set(groups.map(g => g.pid));
    const newPids = groups
      .filter(g => !this._previousPids.has(g.pid))
      .map(g => g.pid);
    this._previousPids = currentPids;

    // Summary from raw data (unfiltered) — always shows overall picture
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
      type: 'update',
      data: groups,
      newPids,
      summary: {
        processes: allGroups.length,
        ports: totalPortsAll,
        publicPorts: publicCountAll
      }
    });
  }

  private _groupByProcess(entries: PortEntry[]): ProcessGroup[] {
    const map = new Map<string, ProcessGroup>();

    for (const entry of entries) {
      const key = `${entry.process_name ?? 'Unknown'}-${entry.pid}`;

      if (!map.has(key)) {
        map.set(key, {
          name: entry.process_name ?? 'Unknown',
          pid: entry.pid,
          ports: []
        });
      }

      map.get(key)!.ports.push(entry);
    }

    return Array.from(map.values());
  }

  private _sortGroups(groups: ProcessGroup[]): void {
    groups.sort((a, b) => {
      // System processes always at the bottom
      const aSystem = a.name.toLowerCase().includes('system');
      const bSystem = b.name.toLowerCase().includes('system');
      if (aSystem && !bSystem) { return 1; }
      if (!aSystem && bSystem) { return -1; }

      switch (this._sortMode) {
        case 'pid':
          return a.pid - b.pid;
        case 'ports':
          return b.ports.length - a.ports.length;
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }

  private async _handleKill(pid: number, processName?: string, portCount?: number): Promise<void> {
    const name = processName || `PID ${pid}`;
    const portInfo = portCount && portCount > 1 ? ` (${portCount} active ports)` : '';
    const confirmMessage = `Kill ${name}${portInfo}?`;

    const confirmation = await vscode.window.showWarningMessage(
      confirmMessage,
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

    // Refresh and verify the process is actually gone
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
    const url = `http://localhost:${port}`;
    vscode.env.openExternal(vscode.Uri.parse(url));
  }

  private _handleAutoRefresh(enabled: boolean): void {
    this._clearAutoRefresh();
    if (enabled) {
      this._autoRefreshInterval = setInterval(() => {
        this.refresh();
      }, 5000);
    }
  }

  private _clearAutoRefresh(): void {
    if (this._autoRefreshInterval) {
      clearInterval(this._autoRefreshInterval);
      this._autoRefreshInterval = undefined as any;
    }
  }

  // ─────────────────────────────────────────────
  // HTML
  // ─────────────────────────────────────────────

  private _getHtml(): string {
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Portviz Dashboard</title>
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
            padding: 0;
            line-height: 1.5;
            display: flex;
            flex-direction: column;
          }

          /* ── STICKY HEADER ── */
          .header-sticky {
            flex-shrink: 0;
            position: sticky;
            top: 0;
            z-index: 10;
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
          }

          /* ── TOP BAR ── */
          .top-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
          }

          .top-bar-title {
            font-size: 15px;
            font-weight: 700;
            letter-spacing: 2px;
            color: var(--vscode-editor-foreground);
          }

          .top-bar-title .accent {
            color: #4fc3f7;
          }

          .top-bar-actions {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .btn-icon {
            background: none;
            border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
            color: var(--vscode-editor-foreground);
            cursor: pointer;
            border-radius: 4px;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            transition: background 0.15s, opacity 0.15s;
          }

          .btn-icon:hover {
            background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
          }

          .btn-icon:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }

          .btn-icon.spinning {
            animation: spin 0.8s linear infinite;
          }

          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }

          /* ── CONTROLS BAR (Filters + Sort + Auto) ── */
          .controls-bar {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 8px 14px;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
            flex-wrap: wrap;
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

          /* Toggle Switch */
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

          .controls-separator {
            width: 1px;
            height: 16px;
            background: var(--vscode-panel-border, rgba(255,255,255,0.1));
            flex-shrink: 0;
          }

          /* Sort dropdown */
          .sort-select {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: 11px;
            color: var(--vscode-editor-foreground);
            background: var(--vscode-input-background, rgba(255,255,255,0.06));
            border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
            border-radius: 4px;
            padding: 2px 6px;
            cursor: pointer;
            outline: none;
          }

          .sort-select:focus {
            border-color: #4fc3f7;
          }

          .sort-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.6));
          }

          /* ── SCROLLABLE CONTENT ── */
          .content {
            flex: 1;
            overflow-y: scroll;
            padding: 6px 0;
          }

          /* ── LOADING ── */
          .loading-state {
            text-align: center;
            padding: 40px 14px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
          }

          /* ── PROCESS ROW ── */
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

          .process-chevron.open {
            transform: rotate(90deg);
          }

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
            color: var(--vscode-editor-foreground);
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

          /* ── PORT ROW ── */
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

          .port-right {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
          }

          /* ── ACTION BUTTONS ── */
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

          .btn-action.open-btn:hover {
            border-color: #4fc3f7;
            color: #4fc3f7;
          }

          .btn-action.kill-btn:hover {
            border-color: #ef5350;
            color: #ef5350;
          }

          /* ── INLINE SVG ICONS ── */
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
            width: 16px;
            height: 16px;
          }

          /* ── FOOTER ── */
          .footer {
            flex-shrink: 0;
            padding: 8px 14px;
            border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
            font-size: 11px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
          }

          /* ── SEMANTIC COLORS ── */
          /* Process dots: based on exposure */
          .dot-green  { background: #66bb6a; } /* all localhost */
          .dot-orange { background: #ffa726; } /* has public port */
          .dot-purple { background: #ab47bc; } /* UDP only */
          .dot-gray   { background: #9e9e9e; } /* system */

          /* Port numbers: based on type */
          .port-local  { color: #66bb6a; } /* localhost */
          .port-public { color: #ffa726; } /* public / 0.0.0.0 */
          .port-udp    { color: #ab47bc; } /* UDP */
          .port-other  { color: #42a5f5; } /* fallback */

          /* ── EMPTY STATE ── */
          .empty-state {
            text-align: center;
            padding: 40px 14px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
          }

          .empty-state .icon {
            font-size: 32px;
            margin-bottom: 8px;
          }

          /* ── NEW PROCESS HIGHLIGHT ── */
          .process-row.highlight {
            background: rgba(79, 195, 247, 0.08);
            transition: background 1.5s ease-out;
          }

          .process-row.highlight-fade {
            background: transparent;
          }
        </style>
      </head>
      <body>

        <!-- STICKY HEADER -->
        <div class="header-sticky">
          <!-- TOP BAR -->
          <div class="top-bar">
            <span class="top-bar-title">PORT<span class="accent">VIZ</span></span>
            <div class="top-bar-actions">
              <button class="btn-icon" id="btn-refresh" title="Refresh"><svg class="icon-svg icon-fill" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.146 4.854l-1.489 1.489A8 8 0 1 0 12 20a8.094 8.094 0 0 0 7.371-4.886 1 1 0 1 0-1.842-.779A6.071 6.071 0 0 1 12 18a6 6 0 1 1 4.243-10.243l-1.39 1.39a.5.5 0 0 0 .354.854H19.5A.5.5 0 0 0 20 9.5V5.207a.5.5 0 0 0-.854-.353z"/></svg></button>
            </div>
          </div>

          <!-- CONTROLS BAR -->
          <div class="controls-bar">
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

            <div class="controls-separator"></div>

            <div class="toggle-group">
              <label class="toggle-switch">
                <input type="checkbox" id="toggle-auto-refresh" />
                <span class="toggle-slider"></span>
              </label>
              <label for="toggle-auto-refresh">Auto Refresh (5s)</label>
            </div>

            <div class="controls-separator"></div>

            <span class="sort-label">Sort by:</span>
            <select class="sort-select" id="sort-mode">
              <option value="name">Name</option>
              <option value="pid">PID</option>
              <option value="ports">Port Count</option>
            </select>
          </div>
        </div>

        <!-- SCROLLABLE CONTENT -->
        <div class="content" id="content">
          <div class="loading-state">Loading\u2026</div>
        </div>

        <!-- FIXED FOOTER -->
        <div class="footer" id="footer"></div>

        <script>
          const vscode = acquireVsCodeApi();

          // Semantic color: process dot based on exposure
          function getProcessDotClass(proc) {
            const name = proc.name.toLowerCase();
            if (name.includes('system') || proc.pid === 0 || proc.pid === 4) return 'dot-gray';
            const hasPublic = proc.ports.some(p => p.local_ip === '0.0.0.0');
            if (hasPublic) return 'dot-orange';
            const allUdp = proc.ports.every(p => p.protocol === 'UDP');
            if (allUdp) return 'dot-purple';
            return 'dot-green';
          }

          // Semantic color: port number based on type
          function getPortColorClass(port) {
            if (port.protocol === 'UDP') return 'port-udp';
            if (port.local_ip === '0.0.0.0') return 'port-public';
            if (port.local_ip === '127.0.0.1' || port.local_ip === '::1') return 'port-local';
            return 'port-other';
          }

          let expandedPids = new Set();
          let currentData = [];
          let newPidSet = new Set();

          function render(data) {
            currentData = data;
            const content = document.getElementById('content');
            const footer = document.getElementById('footer');

            if (!data || data.length === 0) {
              content.innerHTML = '<div class="empty-state"><div class="icon">\u{1F4E1}</div><div>No listening ports found</div></div>';
              footer.textContent = '';
              return;
            }

            let html = '';

            data.forEach((proc, i) => {
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
              html += '<button class="btn-action kill-btn" data-kill-pid="' + proc.pid + '" data-kill-name="' + escapeHtml(proc.name) + '" data-kill-ports="' + portCount + '" title="Kill Process"><svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 6H21"/><path d="M8 6V4C8 3.448 8.448 3 9 3H15C15.552 3 16 3.448 16 4V6"/><path d="M19 6L18.2 19C18.138 19.877 17.406 20.5 16.526 20.5H7.474C6.594 20.5 5.862 19.877 5.8 19L5 6"/><path d="M10 11V17"/><path d="M14 11V17"/></svg></button>';
              html += '</div>';
              html += '</div>';

              if (isOpen) {
                html += '<div class="port-list">';
                proc.ports.forEach(port => {
                  const isPublic = port.local_ip === '0.0.0.0';
                  const address = isPublic ? '0.0.0.0' : 'Localhost';
                  html += '<div class="port-row">';
                  const pColor = getPortColorClass(port);
                  html += '<div class="port-left">';
                  html += '<span class="port-icon">\u{1F4E6}</span>';
                  html += '<span class="port-number ' + pColor + '">' + port.local_port + '</span>';
                  html += '<span class="port-detail">\u00B7 ' + address + ' \u00B7 ' + port.protocol + '</span>';
                  if (isPublic) {
                    html += '<span class="badge-public">\u{1F310} Public</span>';
                  }
                  html += '</div>';
                  html += '<div class="port-right">';
                  if (port.protocol === 'TCP') {
                    html += '<button class="btn-action open-btn" data-open-port="' + port.local_port + '" data-open-ip="' + port.local_ip + '" title="Open in Browser"><svg class="icon-svg icon-fill" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h5V3H3v7h2V5zm0 14h14V9h2v12H3V9h2v10z"/></svg></button>';
                  }
                  html += '</div>';
                  html += '</div>';
                });
                html += '</div>';
              }

              html += '</div>';
            });

            content.innerHTML = html;
            bindEvents();

            // Fade out highlights after render
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

          function updateFooter(summary) {
            const footer = document.getElementById('footer');
            if (!summary) {
              footer.textContent = '';
              return;
            }
            const parts = [];
            parts.push(summary.processes + ' process' + (summary.processes !== 1 ? 'es' : ''));
            parts.push(summary.ports + ' listening port' + (summary.ports !== 1 ? 's' : ''));
            if (summary.publicPorts > 0) {
              parts.push(summary.publicPorts + ' public');
            }
            footer.textContent = parts.join(' \u2022 ');
          }

          function bindEvents() {
            // Toggle expand/collapse
            document.querySelectorAll('.process-header').forEach(el => {
              el.addEventListener('click', () => {
                const pid = Number(el.dataset.pid);
                if (expandedPids.has(pid)) {
                  expandedPids.delete(pid);
                } else {
                  expandedPids.add(pid);
                }
                render(currentData);
              });
            });

            // Kill buttons
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

            // Open buttons
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

          function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
          }

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

          // ── Sort dropdown ──
          document.getElementById('sort-mode').addEventListener('change', (e) => {
            vscode.postMessage({ type: 'sortChange', sort: e.target.value });
          });

          // ── Auto refresh toggle ──
          document.getElementById('toggle-auto-refresh').addEventListener('change', (e) => {
            vscode.postMessage({ type: 'autoRefreshChange', enabled: e.target.checked });
          });

          // ── Listen for messages from extension ──
          window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
              case 'update':
                newPidSet = new Set(msg.newPids || []);
                render(msg.data);
                updateFooter(msg.summary);
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
