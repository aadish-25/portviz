import * as vscode from 'vscode';
import { DashboardViewProvider } from './views/dashboardViewProvider';
import { OrchestrationService } from './services/orchestrationService';
import { NotificationService } from './services/notificationService';
import { ResourceMonitor } from './services/resourceMonitor';

let orchestrationService: OrchestrationService | undefined;
let notificationService: NotificationService | undefined;
let resourceMonitor: ResourceMonitor | undefined;

export function activate(context: vscode.ExtensionContext) {
  orchestrationService = new OrchestrationService(context.globalState);
  notificationService = new NotificationService();
  resourceMonitor = new ResourceMonitor();

  const dashboardProvider = new DashboardViewProvider(
    context.extensionUri,
    context.globalState,
    orchestrationService,
    notificationService,
    resourceMonitor
  );

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
}

export function deactivate() {
  if (resourceMonitor) {
    resourceMonitor.dispose();
    resourceMonitor = undefined;
  }
  if (notificationService) {
    notificationService.dispose();
    notificationService = undefined;
  }
  if (orchestrationService) {
    orchestrationService.dispose();
    orchestrationService = undefined;
  }
}