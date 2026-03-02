import * as vscode from 'vscode';
import { DashboardViewProvider } from './views/dashboardViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const dashboardProvider = new DashboardViewProvider(context.extensionUri, context.globalState);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardViewProvider.viewType,
      dashboardProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('portviz.refresh', async () => {
      await dashboardProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('portviz.showReport', async () => {
      await dashboardProvider.refresh();
    })
  );
}

export function deactivate() { }