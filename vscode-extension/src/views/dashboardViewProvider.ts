import * as vscode from 'vscode';

export class DashboardViewProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'portviz.dashboard';

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
        <title>Portviz Dashboard</title>
      </head>
      <body>
        <h2>Portviz Dashboard</h2>
        <p>WebviewView is working.</p>
      </body>
      </html>
    `;
  }
}
