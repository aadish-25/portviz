import * as vscode from 'vscode';
import { PortEntry } from '../types/report';
export declare class PortsViewProvider implements vscode.TreeDataProvider<PortEntry> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<void>;
    private ports;
    setPorts(data: PortEntry[]): void;
    getTreeItem(element: PortEntry): vscode.TreeItem;
    getChildren(): Thenable<PortEntry[]>;
}
//# sourceMappingURL=portsViewProvider.d.ts.map