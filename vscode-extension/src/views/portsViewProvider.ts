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
    const label = `${element.local_port} • ${element.process_name ?? 'Unknown'} (PID ${element.pid})`;
    return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  }

  getChildren(): Thenable<PortEntry[]> {
    return Promise.resolve(this.ports);
  }
}