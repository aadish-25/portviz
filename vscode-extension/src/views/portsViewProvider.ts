import * as vscode from 'vscode';
import { PortEntry } from '../types/report';

export class PortsViewProvider implements vscode.TreeDataProvider<PortEntry> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private ports: PortEntry[] = [];

  setPorts(data: PortEntry[]) {
    this.ports = data;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PortEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${element.local_port} • ${element.process_name ?? 'Unknown'} (PID ${element.pid})`,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = element.local_ip;
    item.tooltip =
      `Protocol: ${element.protocol}\n` +
      `Local: ${element.local_ip}:${element.local_port}\n` +
      `State: ${element.state}\n` +
      `PID: ${element.pid}\n` +
      `Process: ${element.process_name ?? 'Unknown'}`;

    item.iconPath = new vscode.ThemeIcon('plug');

    return item;
  }

  getChildren(): Thenable<PortEntry[]> {
    return Promise.resolve(this.ports);
  }
}