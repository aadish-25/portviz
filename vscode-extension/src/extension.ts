import * as vscode from 'vscode';
import { CliRunner } from './services/cliRunner';
import { PortsViewProvider } from './views/portsViewProvider';

async function loadPorts(portsProvider: PortsViewProvider) {
  const runner = new CliRunner();
  const result = await runner.runReport();

  if (!result.success || !result.data) {
    vscode.window.showErrorMessage(
      result.error ?? 'Failed to load Portviz data'
    );
    return;
  }

  const listening = result.data.filter(
    p => p.protocol === 'TCP' && p.state === 'LISTENING'
  );

  portsProvider.setPorts(listening);
}

export function activate(context: vscode.ExtensionContext) {
  const portsProvider = new PortsViewProvider();

  vscode.window.registerTreeDataProvider(
    'portviz.portsView',
    portsProvider
  );

  // Auto load on activation
  loadPorts(portsProvider);

  const command = vscode.commands.registerCommand(
    'portviz.showReport',
    async () => {
      await loadPorts(portsProvider);
    }
  );

  context.subscriptions.push(command);

  const refreshCommand = vscode.commands.registerCommand(
    'portviz.refresh',
    async () => {
      await loadPorts(portsProvider);
    }
  );

  context.subscriptions.push(refreshCommand);
}

export function deactivate() { }