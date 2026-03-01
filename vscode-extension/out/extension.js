"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const cliRunner_1 = require("./services/cliRunner");
const portsViewProvider_1 = require("./views/portsViewProvider");
async function loadPorts(portsProvider) {
    const runner = new cliRunner_1.CliRunner();
    const result = await runner.runReport();
    if (!result.success || !result.data) {
        vscode.window.showErrorMessage(result.error ?? 'Failed to load Portviz data');
        return;
    }
    const listening = result.data.filter(p => p.protocol === 'TCP' && p.state === 'LISTENING');
    portsProvider.setPorts(listening);
}
function activate(context) {
    const portsProvider = new portsViewProvider_1.PortsViewProvider();
    vscode.window.registerTreeDataProvider('portviz.portsView', portsProvider);
    // Auto load on activation
    loadPorts(portsProvider);
    const command = vscode.commands.registerCommand('portviz.showReport', async () => {
        await loadPorts(portsProvider);
    });
    context.subscriptions.push(command);
    const refreshCommand = vscode.commands.registerCommand('portviz.refresh', async () => {
        await loadPorts(portsProvider);
    });
    context.subscriptions.push(refreshCommand);
    const killCommand = vscode.commands.registerCommand('portviz.kill', async (port) => {
        if (!port)
            return;
        const isSystemProcess = port.process_name?.toLowerCase().includes('system') ||
            port.pid === 0;
        const confirmMessage = isSystemProcess
            ? `⚠️ You are about to kill a system process (PID ${port.pid}). This may destabilize your system.\n\nContinue?`
            : `Kill process ${port.process_name ?? 'Unknown'} (PID ${port.pid})?`;
        const confirmation = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, 'Yes');
        if (confirmation !== 'Yes')
            return;
        const runner = new cliRunner_1.CliRunner();
        const result = await runner.killProcess(port.pid);
        if (!result.success) {
            vscode.window.showErrorMessage(result.error ?? 'Kill failed');
            return;
        }
        vscode.window.showInformationMessage(`Process ${port.pid} terminated`);
        await loadPorts(portsProvider);
    });
    context.subscriptions.push(killCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map