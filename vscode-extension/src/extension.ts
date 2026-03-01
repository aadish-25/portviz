import * as vscode from 'vscode';
import { LiveViewProvider } from './views/liveViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const liveProvider = new LiveViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      LiveViewProvider.viewType,
      liveProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Refresh command (also accessible from command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand('portviz.refresh', async () => {
      await liveProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('portviz.showReport', async () => {
      await liveProvider.refresh();
    })
  );
}

export function deactivate() { }