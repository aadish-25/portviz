import * as vscode from 'vscode';
import { DashboardViewProvider } from './views/dashboardViewProvider';
import { OrchestrationService } from './services/orchestrationService';

let orchestrationService: OrchestrationService | undefined;

export function activate(context: vscode.ExtensionContext) {
  orchestrationService = new OrchestrationService(context.globalState);
  const dashboardProvider = new DashboardViewProvider(context.extensionUri, context.globalState, orchestrationService);

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

export function deactivate() {
  if (orchestrationService) {
    orchestrationService.dispose();
    orchestrationService = undefined;
  }
}