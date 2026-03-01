import * as vscode from 'vscode';
import { DashboardViewProvider } from './views/dashboardViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const dashboardProvider = new DashboardViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardViewProvider.viewType,
      dashboardProvider
    )
  );
}

export function deactivate() { }