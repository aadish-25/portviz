import { spawn } from 'child_process';
import { PortvizReport } from '../types/report';

export interface CliResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  exitCode: number;
}

export class CliRunner {
  runReport(): Promise<CliResult<PortvizReport>> {
    return new Promise((resolve) => {
      const process = spawn('portviz', ['report', '--json']);

      let stdoutData = '';
      let stderrData = '';

      process.stdout.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString();
      });

      process.stderr.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString();
      });

      process.on('error', (err: Error) => {
        resolve({
          success: false,
          error: `Failed to start Portviz CLI: ${err.message}`,
          exitCode: -1
        });
      });

      process.on('close', (code: number | null) => {
        if (code !== 0) {
          resolve({
            success: false,
            error: stderrData || 'Portviz CLI exited with error.',
            exitCode: code ?? -1
          });
          return;
        }

        try {
          const parsed: PortvizReport = JSON.parse(stdoutData);
          resolve({
            success: true,
            data: parsed,
            exitCode: code ?? 0
          });
        } catch (err: any) {
          resolve({
            success: false,
            error: `Invalid JSON from Portviz CLI: ${err.message}`,
            exitCode: code ?? -1
          });
        }
      });
    });
  }
}