"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliRunner = void 0;
const child_process_1 = require("child_process");
class CliRunner {
    runReport() {
        return new Promise((resolve) => {
            const process = (0, child_process_1.spawn)('portviz', ['report', '--json']);
            let stdoutData = '';
            let stderrData = '';
            process.stdout.on('data', (chunk) => {
                stdoutData += chunk.toString();
            });
            process.stderr.on('data', (chunk) => {
                stderrData += chunk.toString();
            });
            process.on('error', (err) => {
                resolve({
                    success: false,
                    error: `Failed to start Portviz CLI: ${err.message}`,
                    exitCode: -1
                });
            });
            process.on('close', (code) => {
                if (code !== 0) {
                    resolve({
                        success: false,
                        error: stderrData || 'Portviz CLI exited with error.',
                        exitCode: code ?? -1
                    });
                    return;
                }
                try {
                    const parsed = JSON.parse(stdoutData);
                    resolve({
                        success: true,
                        data: parsed,
                        exitCode: code ?? 0
                    });
                }
                catch (err) {
                    resolve({
                        success: false,
                        error: `Invalid JSON from Portviz CLI: ${err.message}`,
                        exitCode: code ?? -1
                    });
                }
            });
        });
    }
    killProcess(pid) {
        return new Promise((resolve) => {
            const process = (0, child_process_1.spawn)('portviz', ['kill', '--pid', String(pid), '--json']);
            let stdoutData = '';
            let stderrData = '';
            process.stdout.on('data', (chunk) => {
                stdoutData += chunk.toString();
            });
            process.stderr.on('data', (chunk) => {
                stderrData += chunk.toString();
            });
            process.on('error', (err) => {
                resolve({
                    success: false,
                    error: `Failed to start Portviz CLI: ${err.message}`,
                    exitCode: -1
                });
            });
            process.on('close', (code) => {
                if (code !== 0) {
                    resolve({
                        success: false,
                        error: stderrData || 'Kill command failed.',
                        exitCode: code ?? -1
                    });
                    return;
                }
                try {
                    const parsed = JSON.parse(stdoutData);
                    resolve({
                        success: true,
                        data: parsed,
                        exitCode: code ?? 0
                    });
                }
                catch (err) {
                    resolve({
                        success: false,
                        error: `Invalid JSON from kill command: ${err.message}`,
                        exitCode: code ?? -1
                    });
                }
            });
        });
    }
}
exports.CliRunner = CliRunner;
//# sourceMappingURL=cliRunner.js.map