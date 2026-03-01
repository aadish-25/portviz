import * as vscode from 'vscode';
import { PortEntry } from '../types/report';
import { PortNode } from '../models/portNode';
export declare class PortsViewProvider implements vscode.TreeDataProvider<PortNode> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<void>;
    private groups;
    setPorts(data: PortEntry[]): void;
    getTreeItem(element: PortNode): vscode.TreeItem;
    getChildren(element?: PortNode): Thenable<PortNode[]>;
}
//# sourceMappingURL=portsViewProvider.d.ts.map