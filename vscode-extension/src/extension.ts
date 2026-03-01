import * as vscode from 'vscode';
import { CliRunner } from './services/cliRunner';
import { PortsViewProvider } from './views/portsViewProvider';
import { PortEntry } from './types/report';

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

  const killCommand = vscode.commands.registerCommand(
    'portviz.kill',
    async (port: PortEntry) => {
      if (!port) return;

      const isSystemProcess =
        port.process_name?.toLowerCase().includes('system') ||
        port.pid === 0;

      const confirmMessage = isSystemProcess
        ? `You are about to kill a system process (PID ${port.pid}). This may destabilize your system.\n\nContinue?`
        : `Kill process ${port.process_name ?? 'Unknown'} (PID ${port.pid})?`;

      const confirmation = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Yes'
      );

      if (confirmation !== 'Yes') return;

      const runner = new CliRunner();
      const result = await runner.killProcess(port.pid);

      if (!result.success) {
        vscode.window.showErrorMessage(result.error ?? 'Kill failed');
        return;
      }

      vscode.window.showInformationMessage(
        `Process ${port.pid} terminated`
      );

      await loadPorts(portsProvider);
    }
  );

  context.subscriptions.push(killCommand);
}

export function deactivate() { }