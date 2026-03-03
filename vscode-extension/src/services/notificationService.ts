import * as vscode from 'vscode';
import { PortEntry } from '../types/report';

export interface PortChangeEvent {
    type: 'opened' | 'closed' | 'public';
    port: number;
    process: string;
    pid: number;
    ip?: string;
}

/**
 * Tracks port state between refreshes and fires VS Code notifications
 * based on user-configured preferences.
 */
export class NotificationService {

    /** Previous set of listening port fingerprints */
    private _previousPorts = new Map<string, PortEntry>();
    private _initialized = false;

    /** Watch list: user-specified ports to monitor */
    private _watchedPorts = new Set<number>();

    /** Custom watchers stored in globalState */
    private _onPortChange = new vscode.EventEmitter<PortChangeEvent>();
    readonly onPortChange = this._onPortChange.event;

    /**
     * Call on each refresh with the full raw port data.
     * Compares with the previous state and fires notifications.
     */
    check(data: PortEntry[]): PortChangeEvent[] {
        const listening = data.filter(p =>
            p.protocol === 'TCP' && p.state === 'LISTENING'
        );

        const currentPorts = new Map<string, PortEntry>();
        for (const p of listening) {
            const key = `${p.local_port}:${p.local_ip}`;
            currentPorts.set(key, p);
        }

        const events: PortChangeEvent[] = [];

        // Skip notification on first load — just baseline
        if (!this._initialized) {
            this._previousPorts = currentPorts;
            this._initialized = true;
            return events;
        }

        const cfg = vscode.workspace.getConfiguration('portviz.notifications');
        const notifyOpened = cfg.get<boolean>('portOpened', false);
        const notifyClosed = cfg.get<boolean>('portClosed', false);
        const notifyPublic = cfg.get<boolean>('publicPort', true);

        // Detect new ports (in current but not previous)
        for (const [key, entry] of currentPorts) {
            if (!this._previousPorts.has(key)) {
                const isPublic = entry.local_ip === '0.0.0.0';
                const name = entry.process_name ?? 'Unknown';

                if (isPublic && notifyPublic) {
                    const evt: PortChangeEvent = { type: 'public', port: entry.local_port, process: name, pid: entry.pid, ip: entry.local_ip };
                    events.push(evt);
                    this._onPortChange.fire(evt);
                    vscode.window.showWarningMessage(
                        `⚠️ Public port detected: :${entry.local_port} (${name}, PID ${entry.pid}) is accessible on 0.0.0.0`
                    );
                } else if (notifyOpened) {
                    const evt: PortChangeEvent = { type: 'opened', port: entry.local_port, process: name, pid: entry.pid, ip: entry.local_ip };
                    events.push(evt);
                    this._onPortChange.fire(evt);
                    vscode.window.showInformationMessage(
                        `Port :${entry.local_port} opened by ${name} (PID ${entry.pid})`
                    );
                }

                // Check watched ports
                if (this._watchedPorts.has(entry.local_port)) {
                    vscode.window.showInformationMessage(
                        `🔔 Watched port :${entry.local_port} is now active (${name})`
                    );
                }
            }
        }

        // Detect closed ports (in previous but not current)
        for (const [key, entry] of this._previousPorts) {
            if (!currentPorts.has(key)) {
                const name = entry.process_name ?? 'Unknown';

                if (notifyClosed) {
                    const evt: PortChangeEvent = { type: 'closed', port: entry.local_port, process: name, pid: entry.pid };
                    events.push(evt);
                    this._onPortChange.fire(evt);
                    vscode.window.showInformationMessage(
                        `Port :${entry.local_port} closed (was ${name}, PID ${entry.pid})`
                    );
                }

                if (this._watchedPorts.has(entry.local_port)) {
                    vscode.window.showWarningMessage(
                        `🔔 Watched port :${entry.local_port} went down (was ${name})`
                    );
                }
            }
        }

        this._previousPorts = currentPorts;
        return events;
    }

    /** Add a port to the watch list */
    addWatch(port: number): void {
        this._watchedPorts.add(port);
    }

    /** Remove a port from the watch list */
    removeWatch(port: number): void {
        this._watchedPorts.delete(port);
    }

    /** Get all watched ports */
    getWatchedPorts(): number[] {
        return [...this._watchedPorts];
    }

    /** Check if a port is watched */
    isWatched(port: number): boolean {
        return this._watchedPorts.has(port);
    }

    dispose(): void {
        this._onPortChange.dispose();
    }
}
