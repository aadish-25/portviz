import * as vscode from 'vscode';

export class OrchestrationViewProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'portviz.orchestration';

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
        <title>Portviz Orchestration</title>
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
            max-width: 220px;
            margin: 0 auto;
          }
        </style>
      </head>
      <body>
        <div class="placeholder">
          <div class="icon">\u{2699}\u{FE0F}</div>
          <div class="title">Orchestration</div>
          <div class="desc">Manage multiple processes at once. Multi-select, batch kill, and process grouping coming soon.</div>
        </div>
      </body>
      </html>
    `;
  }
}
