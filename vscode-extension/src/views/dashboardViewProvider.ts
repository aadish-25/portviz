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

export class DashboardViewProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'portviz.dashboard';

  private _view?: vscode.WebviewView;
  private _rawData: PortEntry[] = [];
  private _filters: FilterState = { hideSystem: true, publicOnly: false, showUdp: false };

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
          await this._handleKill(msg.pid);
          break;

        case 'open':
          this._handleOpen(msg.port, msg.ip);
          break;

        case 'filterChange':
          this._filters = msg.filters;
          this._sendFilteredData();
          break;
      }
    });

    // Auto-load on view open
    this.refresh();
  }

  /** Fetch data from CLI and push to webview */
  public async refresh(): Promise<void> {
    const runner = new CliRunner();
    const result = await runner.runReport();

    if (!result.success || !result.data) {
      vscode.window.showErrorMessage(result.error ?? 'Failed to load Portviz data');
      return;
    }

    this._rawData = result.data;
    this._sendFilteredData();
  }

  /** Apply filters and send grouped data to webview */
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

    this._view.webview.postMessage({ type: 'update', data: groups });
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

    const groups = Array.from(map.values());

    // Sort: system processes to the bottom
    groups.sort((a, b) => {
      const aSystem = a.name.toLowerCase().includes('system');
      const bSystem = b.name.toLowerCase().includes('system');
      if (aSystem && !bSystem) { return 1; }
      if (!aSystem && bSystem) { return -1; }
      return a.name.localeCompare(b.name);
    });

    return groups;
  }

  private async _handleKill(pid: number): Promise<void> {
    const confirmation = await vscode.window.showWarningMessage(
      `Kill process with PID ${pid}?`,
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

    vscode.window.showInformationMessage(`Process ${pid} terminated`);
    await this.refresh();
  }

  private _handleOpen(port: number, ip: string): void {
    const url = `http://localhost:${port}`;
    vscode.env.openExternal(vscode.Uri.parse(url));
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

          body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-editor-foreground);
            background: transparent;
            padding: 0;
            line-height: 1.5;
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
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 2px;
            color: var(--vscode-editor-foreground);
          }

          .top-bar-title .accent {
            color: #4fc3f7;
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
            transition: background 0.15s;
          }

          .btn-icon:hover {
            background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
          }

          .btn-icon.spinning {
            animation: spin 0.8s linear infinite;
          }

          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }

          /* ── FILTER BAR ── */
          .filter-bar {
            display: flex;
            align-items: center;
            gap: 16px;
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
            width: 32px;
            height: 16px;
          }

          .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
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

          /* ── CONTENT ── */
          .content {
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
            padding: 8px 14px;
            cursor: pointer;
            user-select: none;
          }

          .process-header {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .process-chevron {
            font-size: 10px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
            transition: transform 0.15s;
            width: 14px;
            text-align: center;
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

          .process-name {
            font-weight: 600;
            font-size: 13px;
            color: var(--vscode-editor-foreground);
          }

          .process-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
            margin-left: 4px;
          }

          .process-actions {
            margin-left: auto;
            display: flex;
            gap: 4px;
          }

          /* ── PORT ROW ── */
          .port-list {
            padding-left: 36px;
            overflow: hidden;
          }

          .port-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 14px 5px 0;
            border-radius: 4px;
          }

          .port-row:hover {
            background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
          }

          .port-icon {
            font-size: 12px;
            width: 16px;
            text-align: center;
          }

          .port-number {
            font-weight: 700;
            font-size: 13px;
            min-width: 45px;
          }

          .port-detail {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
          }

          .badge-public {
            font-size: 10px;
            font-weight: 600;
            padding: 1px 8px;
            border-radius: 10px;
            background: rgba(255, 167, 38, 0.15);
            color: #ffa726;
            border: 1px solid rgba(255, 167, 38, 0.3);
          }

          .port-actions {
            margin-left: auto;
            display: flex;
            gap: 4px;
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
            transition: background 0.15s, border-color 0.15s;
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

          /* ── FOOTER ── */
          .footer {
            padding: 10px 14px;
            border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
            font-size: 11px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
          }

          /* ── COLOR PALETTE ── */
          .dot-green  { background: #66bb6a; }
          .dot-blue   { background: #42a5f5; }
          .dot-purple { background: #ab47bc; }
          .dot-orange { background: #ffa726; }
          .dot-cyan   { background: #26c6da; }
          .dot-red    { background: #ef5350; }

          .port-green  { color: #66bb6a; }
          .port-orange { color: #ffa726; }
          .port-cyan   { color: #26c6da; }
          .port-blue   { color: #42a5f5; }
          .port-purple { color: #ab47bc; }

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
        </style>
      </head>
      <body>

        <!-- TOP BAR -->
        <div class="top-bar">
          <span class="top-bar-title">PORT<span class="accent">VIZ</span></span>
          <button class="btn-icon" id="btn-refresh" title="Refresh">&#x21bb;</button>
        </div>

        <!-- FILTER BAR -->
        <div class="filter-bar">
          <div class="toggle-group">
            <div class="toggle-switch">
              <input type="checkbox" id="filter-hide-system" checked />
              <span class="toggle-slider"></span>
            </div>
            <label for="filter-hide-system">Hide System</label>
          </div>
          <div class="toggle-group">
            <div class="toggle-switch">
              <input type="checkbox" id="filter-public-only" />
              <span class="toggle-slider"></span>
            </div>
            <label for="filter-public-only">Public Only</label>
          </div>
          <div class="toggle-group">
            <div class="toggle-switch">
              <input type="checkbox" id="filter-show-udp" />
              <span class="toggle-slider"></span>
            </div>
            <label for="filter-show-udp">Show UDP</label>
          </div>
        </div>

        <!-- CONTENT -->
        <div class="content" id="content">
          <div class="loading-state">Loading…</div>
        </div>

        <!-- FOOTER -->
        <div class="footer" id="footer"></div>

        <script>
          const vscode = acquireVsCodeApi();
          const PROCESS_COLORS = ['dot-green', 'dot-blue', 'dot-purple', 'dot-orange', 'dot-cyan', 'dot-red'];
          const PORT_COLORS = ['port-green', 'port-blue', 'port-purple', 'port-orange', 'port-cyan'];

          let expandedPids = new Set();
          let currentData = [];

          function render(data) {
            currentData = data;
            const content = document.getElementById('content');
            const footer = document.getElementById('footer');

            if (!data || data.length === 0) {
              content.innerHTML = '<div class="empty-state"><div class="icon">📡</div><div>No listening ports found</div></div>';
              footer.textContent = '';
              return;
            }

            let totalPorts = 0;
            let html = '';

            data.forEach((proc, i) => {
              const colorClass = PROCESS_COLORS[i % PROCESS_COLORS.length];
              const portColorClass = PORT_COLORS[i % PORT_COLORS.length];
              const isOpen = expandedPids.has(proc.pid);
              const portCount = proc.ports.length;
              totalPorts += portCount;

              html += '<div class="process-row">';
              html += '<div class="process-header" data-pid="' + proc.pid + '">';
              html += '<span class="process-chevron ' + (isOpen ? 'open' : '') + '">&#9654;</span>';
              html += '<span class="process-dot ' + colorClass + '"></span>';
              html += '<span class="process-name">' + escapeHtml(proc.name) + '</span>';
              html += '<span class="process-meta">(' + portCount + ' port' + (portCount !== 1 ? 's' : '') + ')&nbsp;&nbsp;PID ' + proc.pid + '</span>';
              html += '<div class="process-actions">';
              html += '<button class="btn-action kill-btn" data-kill-pid="' + proc.pid + '" title="Kill Process">&#x2716;</button>';
              html += '</div>';
              html += '</div>';

              if (isOpen) {
                html += '<div class="port-list">';
                proc.ports.forEach(port => {
                  const isPublic = port.local_ip === '0.0.0.0';
                  const address = isPublic ? '0.0.0.0' : 'Localhost';
                  html += '<div class="port-row">';
                  html += '<span class="port-icon">&#x1f4e6;</span>';
                  html += '<span class="port-number ' + portColorClass + '">' + port.local_port + '</span>';
                  html += '<span class="port-detail">&bull; ' + address + ' &bull; ' + port.protocol + '</span>';
                  if (isPublic) {
                    html += '<span class="badge-public">&#127760; Public</span>';
                  }
                  html += '<div class="port-actions">';
                  if (port.protocol === 'TCP') {
                    html += '<button class="btn-action open-btn" data-open-port="' + port.local_port + '" data-open-ip="' + port.local_ip + '" title="Open in Browser">&#x2197;</button>';
                  }
                  html += '</div>';
                  html += '</div>';
                });
                html += '</div>';
              }

              html += '</div>';
            });

            content.innerHTML = html;
            footer.textContent = data.length + ' process' + (data.length !== 1 ? 'es' : '') + ' \\u2022 ' + totalPorts + ' listening port' + (totalPorts !== 1 ? 's' : '');

            bindEvents();
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
                vscode.postMessage({ type: 'kill', pid: Number(el.dataset.killPid) });
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
            const btn = document.getElementById('btn-refresh');
            btn.classList.add('spinning');
            vscode.postMessage({ type: 'refresh' });
            setTimeout(() => btn.classList.remove('spinning'), 1000);
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

          // ── Listen for data from extension ──
          window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type === 'update') {
              render(msg.data);
            }
          });
        </script>
      </body>
      </html>
    `;
  }
}
