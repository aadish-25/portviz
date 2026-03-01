import * as vscode from 'vscode';
import { PortEntry } from '../types/report';
import { PortNode, ProcessGroup } from '../models/portNode';

export class PortsViewProvider implements vscode.TreeDataProvider<PortNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private groups: ProcessGroup[] = [];

  setPorts(data: PortEntry[]) {
    const map = new Map<string, ProcessGroup>();

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

      map.get(key)!.ports.push(entry);
    }

    this.groups = Array.from(map.values());
    this.groups.sort((a, b) => {
      const aSystem = a.name.toLowerCase().includes('system');
      const bSystem = b.name.toLowerCase().includes('system');

      if (aSystem && !bSystem) return 1;
      if (!aSystem && bSystem) return -1;

      return a.name.localeCompare(b.name);
    });
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PortNode): vscode.TreeItem {
    // 🔹 Process Level
    if (element.type === 'process') {
      const item = new vscode.TreeItem(
        `${element.name} (${element.ports.length} port${element.ports.length > 1 ? 's' : ''})`,
        vscode.TreeItemCollapsibleState.Expanded
      );

      item.iconPath = new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor('charts.blue')
      );

      item.description = `PID ${element.pid}`;
      return item;
    }

    // 🔹 Port Level
    const port = element.entry;

    const isPublic = port.local_ip === '0.0.0.0';
    const isLocal = port.local_ip === '127.0.0.1';

    const label = new vscode.TreeItem(
      `${port.local_port}`,
      vscode.TreeItemCollapsibleState.None
    );

    // Neon icon coloring
    label.iconPath = new vscode.ThemeIcon(
      'plug',
      new vscode.ThemeColor(
        isPublic ? 'charts.orange' : 'charts.green'
      )
    );

    // Description line (clean secondary text)
    label.description = `${isLocal ? 'Localhost' : port.local_ip} • ${port.protocol}`;

    // Tooltip (detailed)
    label.tooltip =
      `Port: ${port.local_port}\n` +
      `Process: ${port.process_name ?? 'Unknown'}\n` +
      `PID: ${port.pid}\n` +
      `Address: ${port.local_ip}\n` +
      `Protocol: ${port.protocol}\n` +
      `State: ${port.state}`;

    if (isPublic) {
      label.description += ' • Public';
    }

    return label;
  }

  getChildren(element?: PortNode): Thenable<PortNode[]> {
    // Top Level → Processes
    if (!element) {
      return Promise.resolve(this.groups);
    }

    // Process → Ports
    if (element.type === 'process') {
      return Promise.resolve(
        element.ports.map(p => ({
          type: 'port',
          entry: p
        }))
      );
    }

    return Promise.resolve([]);
  }
}