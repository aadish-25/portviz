import * as vscode from 'vscode';
import { CliRunner } from './services/cliRunner';
import { PortsViewProvider } from './views/portsViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const portsProvider = new PortsViewProvider();

  vscode.window.registerTreeDataProvider(
    'portviz.portsView',
    portsProvider
  );

  const command = vscode.commands.registerCommand(
    'portviz.showReport',
    async () => {
      const runner = new CliRunner();
      const result = await runner.runReport();

      if (!result.success || !result.data) {
        vscode.window.showErrorMessage(
          result.error ?? 'Unknown error'
        );
        return;
      }

      const listening = result.data.filter(
        p => p.protocol === 'TCP' && p.state === 'LISTENING'
      );

      portsProvider.setPorts(listening);
    }
  );

  context.subscriptions.push(command);
}

export function deactivate() { }