import * as vscode from 'vscode';

export class SnapshotsViewProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'portviz.snapshots';

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
  }

  private _getHtml(): string {
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Portviz Snapshots</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: calc(var(--vscode-font-size, 13px) + 1px);
            color: var(--vscode-editor-foreground);
            background: transparent;
            padding: 16px 14px;
            line-height: 1.5;
          }

          .placeholder {
            text-align: center;
            padding: 30px 0;
          }

          .placeholder .icon {
            font-size: 28px;
            margin-bottom: 10px;
          }

          .placeholder .title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 4px;
          }

          .placeholder .desc {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, rgba(255,255,255,0.5));
            margin-bottom: 16px;
          }

          .btn-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
          }

          .btn-placeholder {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
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
        <div class="placeholder">
          <div class="icon">\u{1F4F8}</div>
          <div class="title">Snapshots</div>
          <div class="desc">Save and compare port states over time.</div>
          <div class="btn-group">
            <div class="btn-placeholder">\u{1F4BE} Save Snapshot</div>
            <div class="btn-placeholder">\u{1F504} Compare Snapshots</div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
