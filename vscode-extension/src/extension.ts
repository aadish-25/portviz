import * as vscode from 'vscode';
import { CliRunner } from './services/cliRunner';

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand(
    'portviz.showReport',
    async () => {
      const outputChannel = vscode.window.createOutputChannel('Portviz');
      outputChannel.clear();
      outputChannel.show(true);

      const runner = new CliRunner();
      const result = await runner.runReport();

      if (!result.success) {
        outputChannel.appendLine(`Error: ${result.error}`);
        return;
      }

      outputChannel.appendLine(JSON.stringify(result.data, null, 2));
    }
  );

  context.subscriptions.push(command);
}

export function deactivate() {}