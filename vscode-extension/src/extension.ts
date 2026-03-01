import * as vscode from 'vscode';
import { OverviewViewProvider } from './views/overviewViewProvider';
import { LiveViewProvider } from './views/liveViewProvider';
import { SnapshotsViewProvider } from './views/snapshotsViewProvider';
import { OrchestrationViewProvider } from './views/orchestrationViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const overviewProvider = new OverviewViewProvider(context.extensionUri);
  const liveProvider = new LiveViewProvider(context.extensionUri);
  const snapshotsProvider = new SnapshotsViewProvider(context.extensionUri);
  const orchestrationProvider = new OrchestrationViewProvider(context.extensionUri);

  // Register all view providers
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      OverviewViewProvider.viewType,
      overviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.window.registerWebviewViewProvider(
      LiveViewProvider.viewType,
      liveProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.window.registerWebviewViewProvider(
      SnapshotsViewProvider.viewType,
      snapshotsProvider
    ),
    vscode.window.registerWebviewViewProvider(
      OrchestrationViewProvider.viewType,
      orchestrationProvider
    )
  );

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('portviz.refresh', async () => {
      await liveProvider.refresh();
      await overviewProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('portviz.showReport', async () => {
      await liveProvider.refresh();
    })
  );
}

export function deactivate() { }