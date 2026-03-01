import * as vscode from 'vscode';
import { CliRunner } from './services/cliRunner';
import { PortsViewProvider } from './views/portsViewProvider';
import { ProcessGroup } from "./models/portNode"
import { PortNode } from './models/portNode';

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
    async (node: ProcessGroup) => {

      if (!node || node.type !== 'process') return;

      const pid = node.pid;
      const processName = node.name;

      const isSystemProcess =
        processName.toLowerCase().includes('system') ||
        pid === 0;

      const confirmMessage = isSystemProcess
        ? `You are about to kill a system process (PID ${pid}). This may destabilize your system.\n\nContinue?`
        : `Kill process ${processName} (PID ${pid})?`;

      const confirmation = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Yes'
      );

      if (confirmation !== 'Yes') return;

      const runner = new CliRunner();
      const result = await runner.killProcess(pid);

      if (!result.success) {
        vscode.window.showErrorMessage(result.error ?? 'Kill failed');
        return;
      }

      vscode.window.showInformationMessage(
        `Process ${pid} terminated`
      );

      await loadPorts(portsProvider);
    }
  );

  context.subscriptions.push(killCommand);

  const openCommand = vscode.commands.registerCommand(
    'portviz.openInBrowser',
    async (node: PortNode) => {

      if (!node || node.type !== 'port') return;

      const port = node.entry;

      if (port.protocol !== 'TCP') return;

      const isPublic = port.local_ip === '0.0.0.0';
      const isLocal = port.local_ip === '127.0.0.1';

      if (!isPublic && !isLocal) return;

      const url = isPublic
        ? `http://localhost:${port.local_port}`
        : `http://localhost:${port.local_port}`;

      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  );

  context.subscriptions.push(openCommand);
}

export function deactivate() { }