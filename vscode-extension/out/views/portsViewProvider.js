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
exports.PortsViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class PortsViewProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.groups = [];
    }
    // ---------------------------
    // GROUP PORTS BY PROCESS
    // ---------------------------
    setPorts(data) {
        const map = new Map();
        for (const entry of data) {
            const key = `${entry.process_name ?? 'Unknown'}-${entry.pid}`;
            if (!map.has(key)) {
                map.set(key, {
                    type: 'process',
                    name: entry.process_name ?? 'Unknown',
                    pid: entry.pid,
                    ports: []
                });
            }
            map.get(key).ports.push(entry);
        }
        this.groups = Array.from(map.values());
        // Move system processes to bottom
        this.groups.sort((a, b) => {
            const aSystem = a.name.toLowerCase().includes('system');
            const bSystem = b.name.toLowerCase().includes('system');
            if (aSystem && !bSystem)
                return 1;
            if (!aSystem && bSystem)
                return -1;
            return a.name.localeCompare(b.name);
        });
        this._onDidChangeTreeData.fire();
    }
    // ---------------------------
    // TREE ITEM RENDERING
    // ---------------------------
    getTreeItem(element) {
        // 🔹 PROCESS NODE
        if (element.type === 'process') {
            const item = new vscode.TreeItem(`${element.name} (${element.ports.length} port${element.ports.length > 1 ? 's' : ''})`, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
            item.description = `PID ${element.pid}`;
            // Kill allowed ONLY on process nodes
            item.contextValue = 'process';
            return item;
        }
        // 🔹 PORT NODE
        if (element.type === 'port') {
            const port = element.entry;
            const isPublic = port.local_ip === '0.0.0.0';
            const item = new vscode.TreeItem(`${port.local_port}`, vscode.TreeItemCollapsibleState.Collapsed);
            item.iconPath = new vscode.ThemeIcon('plug', new vscode.ThemeColor(isPublic ? 'charts.orange' : 'charts.green'));
            if (isPublic) {
                item.description = 'Public';
            }
            // No kill option here
            item.contextValue = 'port';
            return item;
        }
        // 🔹 DETAIL NODE
        if (element.type === 'detail') {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('circle-small', new vscode.ThemeColor('charts.blue'));
            item.contextValue = 'detail';
            return item;
        }
        // Fallback (should never hit)
        return new vscode.TreeItem('');
    }
    // ---------------------------
    // CHILD RESOLUTION
    // ---------------------------
    getChildren(element) {
        // Top level → process groups
        if (!element) {
            return Promise.resolve(this.groups);
        }
        // Process → ports
        if (element.type === 'process') {
            return Promise.resolve(element.ports.map(p => ({
                type: 'port',
                entry: p
            })));
        }
        // Port → metadata details
        if (element.type === 'port') {
            const p = element.entry;
            return Promise.resolve([
                { type: 'detail', label: `Address: ${p.local_ip}` },
                { type: 'detail', label: `Protocol: ${p.protocol}` },
                { type: 'detail', label: `State: ${p.state}` },
                { type: 'detail', label: `PID: ${p.pid}` }
            ]);
        }
        return Promise.resolve([]);
    }
}
exports.PortsViewProvider = PortsViewProvider;
//# sourceMappingURL=portsViewProvider.js.map