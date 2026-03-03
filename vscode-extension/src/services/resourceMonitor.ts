import { execFile } from 'child_process';
import * as vscode from 'vscode';
import * as os from 'os';

export interface ProcessResources {
    pid: number;
    cpu: number;     // percentage (0-100)
    memory: number;  // bytes
    memoryMB: number;
}

/**
 * Polls OS-level CPU + memory for a set of PIDs.
 * Uses platform-native commands so no external deps needed.
 */
export class ResourceMonitor {

    private _cache = new Map<number, ProcessResources>();
    private _timer: ReturnType<typeof setInterval> | undefined;
    private _trackedPids = new Set<number>();
    private _onUpdate = new vscode.EventEmitter<Map<number, ProcessResources>>();
    readonly onUpdate = this._onUpdate.event;

    /** Start polling for a set of PIDs */
    track(pids: number[]): void {
        this._trackedPids = new Set(pids.filter(p => p > 4)); // skip system
        if (this._trackedPids.size === 0) { return; }
        this._poll(); // immediate first poll
    }

    /** Start periodic polling */
    startPolling(): void {
        this.stopPolling();
        const cfg = vscode.workspace.getConfiguration('portviz.resourceMonitor');
        if (!cfg.get<boolean>('enabled', true)) { return; }
        const intervalSec = cfg.get<number>('refreshInterval', 10);
        this._timer = setInterval(() => this._poll(), intervalSec * 1000);
    }

    stopPolling(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
    }

    getCache(): Map<number, ProcessResources> {
        return this._cache;
    }

    /** Build a pid→resources map for a specific set of pids from cache */
    getFor(pids: number[]): Record<number, ProcessResources> {
        const result: Record<number, ProcessResources> = {};
        for (const pid of pids) {
            const r = this._cache.get(pid);
            if (r) { result[pid] = r; }
        }
        return result;
    }

    private _poll(): void {
        if (this._trackedPids.size === 0) { return; }
        const pids = [...this._trackedPids];
        if (os.platform() === 'win32') {
            this._pollWindows(pids);
        } else {
            this._pollUnix(pids);
        }
    }

    private _pollWindows(pids: number[]): void {
        // Use WMIC to get CPU (via perf counter) + WorkingSetSize in one call
        // PowerShell is more reliable for CPU on Windows
        const pidFilter = pids.map(p => `ProcessId=${p}`).join(' or ');
        const cmd = `Get-CimInstance Win32_Process -Filter "${pidFilter}" | Select-Object ProcessId,WorkingSetSize | ConvertTo-Json -Compress`;

        execFile('powershell', ['-NoProfile', '-Command', cmd], { timeout: 8000 }, (err, stdout) => {
            if (err || !stdout.trim()) { return; }
            try {
                let data = JSON.parse(stdout.trim());
                if (!Array.isArray(data)) { data = [data]; }

                // Also get CPU via Get-Process
                const pidList = pids.join(',');
                const cpuCmd = `Get-Process -Id ${pidList} -ErrorAction SilentlyContinue | Select-Object Id,CPU | ConvertTo-Json -Compress`;

                execFile('powershell', ['-NoProfile', '-Command', cpuCmd], { timeout: 8000 }, (cpuErr, cpuOut) => {
                    const cpuMap = new Map<number, number>();
                    if (!cpuErr && cpuOut.trim()) {
                        try {
                            let cpuData = JSON.parse(cpuOut.trim());
                            if (!Array.isArray(cpuData)) { cpuData = [cpuData]; }
                            for (const item of cpuData) {
                                if (item.Id && item.CPU != null) {
                                    cpuMap.set(item.Id, item.CPU);
                                }
                            }
                        } catch { /* ignore parse errors */ }
                    }

                    for (const item of data) {
                        const pid = item.ProcessId;
                        const mem = item.WorkingSetSize ?? 0;
                        const prevCpu = this._cache.get(pid)?.cpu ?? 0;
                        const rawCpu = cpuMap.get(pid) ?? 0;
                        // Get-Process .CPU is total seconds; approximate % by delta
                        const prevRawCpu = (this as any)[`_rawCpu_${pid}`] ?? rawCpu;
                        const cfg = vscode.workspace.getConfiguration('portviz.resourceMonitor');
                        const interval = cfg.get<number>('refreshInterval', 10);
                        const cpuDelta = rawCpu - prevRawCpu;
                        const cpuPct = Math.min(100, Math.max(0, (cpuDelta / interval) * 100));
                        (this as any)[`_rawCpu_${pid}`] = rawCpu;

                        this._cache.set(pid, {
                            pid,
                            cpu: cpuPct > 0.1 ? Math.round(cpuPct * 10) / 10 : prevCpu > 0 ? 0 : 0,
                            memory: mem,
                            memoryMB: Math.round(mem / 1048576 * 10) / 10
                        });
                    }
                    this._onUpdate.fire(this._cache);
                });
            } catch { /* ignore */ }
        });
    }

    private _pollUnix(pids: number[]): void {
        const pidList = pids.join(',');
        execFile('ps', ['-p', pidList, '-o', 'pid,%cpu,rss', '--no-headers'], { timeout: 5000 }, (err, stdout) => {
            if (err || !stdout.trim()) { return; }

            for (const line of stdout.trim().split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 3) { continue; }
                const pid = parseInt(parts[0]!, 10);
                const cpu = parseFloat(parts[1]!);
                const rssKB = parseInt(parts[2]!, 10);
                if (isNaN(pid)) { continue; }

                this._cache.set(pid, {
                    pid,
                    cpu: Math.round(cpu * 10) / 10,
                    memory: rssKB * 1024,
                    memoryMB: Math.round(rssKB / 1024 * 10) / 10
                });
            }
            this._onUpdate.fire(this._cache);
        });
    }

    dispose(): void {
        this.stopPolling();
        this._onUpdate.dispose();
        this._cache.clear();
    }
}
