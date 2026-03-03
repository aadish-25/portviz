import { spawn, ChildProcess } from 'child_process';
import { PortvizReport } from '../types/report';

export interface CliResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  exitCode: number;
}

/** Default CLI timeout in milliseconds */
const CLI_TIMEOUT = 15000;

export class CliRunner {
  runReport(): Promise<CliResult<PortvizReport>> {
    return this._exec<PortvizReport>(['report', '--json']);
  }

  killProcess(pid: number): Promise<CliResult<any>> {
    return this._exec<any>(['kill', '--pid', String(pid), '--json']);
  }

  private _exec<T>(args: string[]): Promise<CliResult<T>> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn('portviz', args);
      } catch (err: any) {
        resolve({ success: false, error: `Failed to start Portviz CLI: ${err.message}`, exitCode: -1 });
        return;
      }

      let stdoutData = '';
      let stderrData = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill();
          resolve({ success: false, error: `Portviz CLI timed out after ${CLI_TIMEOUT / 1000}s`, exitCode: -1 });
        }
      }, CLI_TIMEOUT);

      child.stdout?.on('data', (chunk: Buffer) => { stdoutData += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderrData += chunk.toString(); });

      child.on('error', (err: Error) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, error: `Failed to start Portviz CLI: ${err.message}`, exitCode: -1 });
      });

      child.on('close', (code: number | null) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);

        if (code !== 0) {
          resolve({ success: false, error: stderrData || 'Portviz CLI exited with error.', exitCode: code ?? -1 });
          return;
        }

        try {
          const parsed: T = JSON.parse(stdoutData);
          resolve({ success: true, data: parsed, exitCode: code ?? 0 });
        } catch (err: any) {
          resolve({ success: false, error: `Invalid JSON from Portviz CLI: ${err.message}`, exitCode: code ?? -1 });
        }
      });
    });
  }
}