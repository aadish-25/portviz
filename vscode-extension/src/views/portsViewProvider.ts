import * as vscode from 'vscode';
import { PortEntry } from '../types/report';
import { PortNode, ProcessGroup } from '../models/portNode';

export class PortsViewProvider implements vscode.TreeDataProvider<PortNode> {

  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private groups: ProcessGroup[] = [];

  // ---------------------------
  // GROUP PORTS BY PROCESS
  // ---------------------------
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

    // Move system processes to bottom
    this.groups.sort((a, b) => {
      const aSystem = a.name.toLowerCase().includes('system');
      const bSystem = b.name.toLowerCase().includes('system');

      if (aSystem && !bSystem) return 1;
      if (!aSystem && bSystem) return -1;

      return a.name.localeCompare(b.name);
    });

    this._onDidChangeTreeData.fire();
  }

  // ---------------------------
  // TREE ITEM RENDERING
  // ---------------------------
  getTreeItem(element: PortNode): vscode.TreeItem {

    // 🔹 PROCESS NODE
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

      // Kill allowed ONLY on process nodes
      item.contextValue = 'process';

      return item;
    }

    // 🔹 PORT NODE
    if (element.type === 'port') {

      const port = element.entry;
      const isPublic = port.local_ip === '0.0.0.0';

      const item = new vscode.TreeItem(
        `${port.local_port}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );

      item.iconPath = new vscode.ThemeIcon(
        'plug',
        new vscode.ThemeColor(
          isPublic ? 'charts.orange' : 'charts.green'
        )
      );

      if (isPublic) {
        item.description = 'Public';
      }

      // No kill option here
      item.contextValue = 'port';

      return item;
    }

    // 🔹 DETAIL NODE
    if (element.type === 'detail') {

      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None
      );

      item.iconPath = new vscode.ThemeIcon(
        'circle-small',
        new vscode.ThemeColor('charts.blue')
      );

      item.contextValue = 'detail';

      return item;
    }

    // Fallback (should never hit)
    return new vscode.TreeItem('');
  }

  // ---------------------------
  // CHILD RESOLUTION
  // ---------------------------
  getChildren(element?: PortNode): Thenable<PortNode[]> {

    // Top level → process groups
    if (!element) {
      return Promise.resolve(this.groups);
    }

    // Process → ports
    if (element.type === 'process') {
      return Promise.resolve(
        element.ports.map(p => ({
          type: 'port',
          entry: p
        }))
      );
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