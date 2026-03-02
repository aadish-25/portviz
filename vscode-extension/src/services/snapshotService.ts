import * as vscode from 'vscode';
import { PortEntry } from '../types/report';
import { Snapshot, SnapshotDiff } from '../types/snapshot';

const STORAGE_KEY = 'portviz.snapshots';
const MAX_SNAPSHOTS = 15;

export class SnapshotService {

  constructor(private readonly _state: vscode.Memento) {}

  /** Get all snapshots, newest first */
  getAll(): Snapshot[] {
    const raw = this._state.get<Snapshot[]>(STORAGE_KEY, []);
    return raw.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Save a new snapshot from current data */
  save(name: string, data: PortEntry[]): Snapshot {
    const listening = data.filter(p =>
      p.protocol === 'TCP' && p.state === 'LISTENING'
    );

    const processSet = new Set(listening.map(p => `${p.process_name}-${p.pid}`));
    const publicCount = listening.filter(p => p.local_ip === '0.0.0.0').length;

    const snapshot: Snapshot = {
      id: this._generateId(),
      name,
      createdAt: new Date().toISOString(),
      portCount: listening.length,
      publicCount,
      processCount: processSet.size,
      data: listening
    };

    const all = this.getAll();

    // Cap at MAX_SNAPSHOTS: remove oldest if over limit
    while (all.length >= MAX_SNAPSHOTS) {
      all.pop();
    }

    all.unshift(snapshot);
    this._persist(all);

    return snapshot;
  }

  /** Delete a snapshot by ID */
  delete(id: string): boolean {
    const all = this.getAll();
    const filtered = all.filter(s => s.id !== id);
    if (filtered.length === all.length) { return false; }
    this._persist(filtered);
    return true;
  }

  /** Rename a snapshot */
  rename(id: string, newName: string): boolean {
    const all = this.getAll();
    const snap = all.find(s => s.id === id);
    if (!snap) { return false; }
    snap.name = newName;
    this._persist(all);
    return true;
  }

  /** Compare two snapshots */
  compare(idA: string, idB: string): SnapshotDiff | null {
    const all = this.getAll();
    const snapA = all.find(s => s.id === idA);
    const snapB = all.find(s => s.id === idB);
    if (!snapA || !snapB) { return null; }

    // Create port fingerprints
    const keyOf = (p: PortEntry) => `${p.local_port}:${p.protocol}:${p.local_ip}`;
    const procOf = (p: PortEntry) => p.process_name ?? 'Unknown';

    const portsA = new Map(snapA.data.map(p => [keyOf(p), p]));
    const portsB = new Map(snapB.data.map(p => [keyOf(p), p]));

    const procsA = new Set(snapA.data.map(p => `${procOf(p)}-${p.pid}`));
    const procsB = new Set(snapB.data.map(p => `${procOf(p)}-${p.pid}`));

    const addedPorts = [...portsB.entries()]
      .filter(([key]) => !portsA.has(key))
      .map(([, p]) => ({
        port: p.local_port,
        process: procOf(p),
        protocol: p.protocol,
        ip: p.local_ip
      }));

    const removedPorts = [...portsA.entries()]
      .filter(([key]) => !portsB.has(key))
      .map(([, p]) => ({
        port: p.local_port,
        process: procOf(p),
        protocol: p.protocol,
        ip: p.local_ip
      }));

    const addedProcesses = [...procsB].filter(p => !procsA.has(p));
    const removedProcesses = [...procsA].filter(p => !procsB.has(p));

    let unchangedPorts = 0;
    for (const key of portsA.keys()) {
      if (portsB.has(key)) { unchangedPorts++; }
    }

    return { addedPorts, removedPorts, addedProcesses, removedProcesses, unchangedPorts };
  }

  /** Estimate storage size in bytes */
  getStorageSize(): number {
    const all = this.getAll();
    return new TextEncoder().encode(JSON.stringify(all)).length;
  }

  private _persist(snapshots: Snapshot[]): void {
    this._state.update(STORAGE_KEY, snapshots);
  }

  private _generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
}
