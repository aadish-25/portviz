import * as vscode from 'vscode';

/**
 * Manages persistent terminal sessions per service.
 * Supports sequential multi-command execution in the same terminal
 * (critical for venv activation + run flows).
 */
export class TerminalManager {

  private _terminals = new Map<string, vscode.Terminal>();

  constructor() {
    // Clean up references when terminals are closed
    vscode.window.onDidCloseTerminal(term => {
      for (const [id, t] of this._terminals) {
        if (t === term) {
          this._terminals.delete(id);
          break;
        }
      }
    });
  }

  /**
   * Execute a list of commands sequentially in a persistent terminal.
   * Uses the same terminal session so environment state (venv, etc.) persists.
   */
  async execute(
    serviceId: string,
    serviceName: string,
    commands: string[],
    cwd: string
  ): Promise<void> {
    if (commands.length === 0) { return; }

    // Reuse or create terminal
    let terminal = this._terminals.get(serviceId);
    if (!terminal || this._isTerminalClosed(terminal)) {
      const options: vscode.TerminalOptions = {
        name: `Portviz: ${serviceName}`
      };
      if (cwd) {
        options.cwd = cwd;
      }
      terminal = vscode.window.createTerminal(options);
      this._terminals.set(serviceId, terminal);
    }

    terminal.show(false); // show but don't take focus

    // Send cd if working directory specified
    if (cwd) {
      terminal.sendText(`cd "${cwd}"`);
    }

    // Execute commands sequentially in the same session
    for (const cmd of commands) {
      const trimmed = cmd.trim();
      if (!trimmed) { continue; }
      terminal.sendText(trimmed);
    }
  }

  /** Stop a service's terminal */
  stop(serviceId: string): void {
    const terminal = this._terminals.get(serviceId);
    if (terminal) {
      terminal.dispose();
      this._terminals.delete(serviceId);
    }
  }

  /** Check if a service has an active terminal */
  hasActiveTerminal(serviceId: string): boolean {
    const terminal = this._terminals.get(serviceId);
    return !!terminal && !this._isTerminalClosed(terminal);
  }

  /** Dispose all managed terminals */
  disposeAll(): void {
    for (const [, terminal] of this._terminals) {
      terminal.dispose();
    }
    this._terminals.clear();
  }

  private _isTerminalClosed(terminal: vscode.Terminal): boolean {
    return terminal.exitStatus !== undefined;
  }
}
