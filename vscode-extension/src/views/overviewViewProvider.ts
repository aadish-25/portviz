import * as vscode from 'vscode';
import { CliRunner } from '../services/cliRunner';
import { PortEntry } from '../types/report';

export class OverviewViewProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'portviz.overview';

  private _view?: vscode.WebviewView;

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

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'refresh') {
        await this.refresh();
      }
    });

    this.refresh();
  }

  public async refresh(): Promise<void> {
    const runner = new CliRunner();
    const result = await runner.runReport();

    if (!result.success || !result.data) {
      this._view?.webview.postMessage({ type: 'update', data: null });
      return;
    }

    const raw = result.data;

    // Compute metrics from raw data
    const listening = raw.filter(p =>
      (p.protocol === 'TCP' && p.state === 'LISTENING') || p.protocol === 'UDP'
    );

    const processSet = new Set(listening.map(p => `${p.process_name}-${p.pid}`));
    const publicPorts = listening.filter(p => p.local_ip === '0.0.0.0');
    const udpPorts = listening.filter(p => p.protocol === 'UDP');

    // Risk: public services grouped by process
    const riskMap = new Map<string, { name: string; pid: number; ports: PortEntry[] }>();
    for (const p of publicPorts) {
      const key = `${p.process_name}-${p.pid}`;
      if (!riskMap.has(key)) {
        riskMap.set(key, { name: p.process_name ?? 'Unknown', pid: p.pid, ports: [] });
      }
      riskMap.get(key)!.ports.push(p);
    }

    this._view?.webview.postMessage({
      type: 'update',
      data: {
        totalProcesses: processSet.size,
        listeningPorts: listening.length,
        publicPorts: publicPorts.length,
        udpPorts: udpPorts.length,
        lastUpdated: new Date().toLocaleTimeString(),
        riskServices: Array.from(riskMap.values())
      }
    });
  }

  private _getHtml(): string {
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Portviz Overview</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }

          html, body {
            height: 100%;
            overflow-y: auto;
          }

          body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: calc(var(--vscode-font-size, 13px) + 1px);
            color: var(--vscode-editor-foreground);
            background: transparent;
            padding: 12px 14px;
            line-height: 1.5;
          }

          .section {
            margin-bottom: 20px;
          }

          .section-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
            margin-bottom: 10px;
            padding-bottom: 4px;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
          }

          /* ── METRIC CARDS ── */
          .metrics-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }

          .metric-card {
            padding: 10px 12px;
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
            background: var(--vscode-input-background, rgba(255,255,255,0.04));
          }

          .metric-value {
            font-size: 20px;
            font-weight: 700;
            line-height: 1.2;
          }

          .metric-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
            margin-top: 2px;
          }

          .metric-value.green  { color: #66bb6a; }
          .metric-value.blue   { color: #42a5f5; }
          .metric-value.orange { color: #ffa726; }
          .metric-value.purple { color: #ab47bc; }

          .metric-card.full-width {
            grid-column: 1 / -1;
          }

          .metric-card.full-width .metric-value {
            font-size: 12px;
            font-weight: 400;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
          }

          /* ── RISK LIST ── */
          .risk-empty {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
            padding: 8px 0;
          }

          .risk-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 0;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.05));
          }

          .risk-item:last-child {
            border-bottom: none;
          }

          .risk-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ffa726;
            flex-shrink: 0;
          }

          .risk-info {
            flex: 1;
            min-width: 0;
          }

          .risk-name {
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .risk-detail {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
          }

          .risk-badge {
            font-size: 10px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 999px;
            background: rgba(255, 167, 38, 0.12);
            color: #ffa726;
            border: 1px solid rgba(255, 167, 38, 0.25);
            white-space: nowrap;
            flex-shrink: 0;
          }

          /* ── LOADING ── */
          .loading {
            text-align: center;
            padding: 40px 0;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.4));
          }
        </style>
      </head>
      <body>
        <div id="content">
          <div class="loading">Loading\u2026</div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type !== 'update') return;

            const el = document.getElementById('content');

            if (!msg.data) {
              el.innerHTML = '<div class="loading">No data available</div>';
              return;
            }

            const d = msg.data;
            let html = '';

            // ── SECTION 1 — Summary Metrics ──
            html += '<div class="section">';
            html += '<div class="section-title">Summary</div>';
            html += '<div class="metrics-grid">';
            html += metric(d.totalProcesses, 'Processes', 'green');
            html += metric(d.listeningPorts, 'Listening Ports', 'blue');
            html += metric(d.publicPorts, 'Public Ports', 'orange');
            html += metric(d.udpPorts, 'UDP Ports', 'purple');
            html += '<div class="metric-card full-width"><div class="metric-value">Last updated: ' + d.lastUpdated + '</div></div>';
            html += '</div>';
            html += '</div>';

            // ── SECTION 2 — Risk Insight ──
            html += '<div class="section">';
            html += '<div class="section-title">Risk Insight \u2014 Public Services</div>';

            if (d.riskServices.length === 0) {
              html += '<div class="risk-empty">\u2705 No publicly exposed services</div>';
            } else {
              d.riskServices.forEach(svc => {
                const ports = svc.ports.map(p => p.local_port).join(', ');
                html += '<div class="risk-item">';
                html += '<span class="risk-dot"></span>';
                html += '<div class="risk-info">';
                html += '<div class="risk-name">' + escapeHtml(svc.name) + '</div>';
                html += '<div class="risk-detail">PID ' + svc.pid + ' \u00B7 Ports: ' + ports + '</div>';
                html += '</div>';
                html += '<span class="risk-badge">0.0.0.0</span>';
                html += '</div>';
              });
            }

            html += '</div>';

            el.innerHTML = html;
          });

          function metric(value, label, colorClass) {
            return '<div class="metric-card">' +
              '<div class="metric-value ' + colorClass + '">' + value + '</div>' +
              '<div class="metric-label">' + label + '</div>' +
            '</div>';
          }

          function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
          }
        </script>
      </body>
      </html>
    `;
  }
}
