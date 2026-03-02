import * as vscode from 'vscode';
import { PortEntry } from '../types/report';
import { Snapshot, SnapshotDiff, DiffProcessGroup } from '../types/snapshot';

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

  /** Compare two snapshots — returns grouped structured diff */
  compare(idA: string, idB: string, isLiveCompare = false): SnapshotDiff | null {
    const all = this.getAll();
    const snapA = all.find(s => s.id === idA);
    const snapB = all.find(s => s.id === idB);
    if (!snapA || !snapB) { return null; }

    // Create port fingerprints
    const keyOf = (p: PortEntry) => `${p.local_port}:${p.protocol}:${p.local_ip}`;

    const portsA = new Map(snapA.data.map(p => [keyOf(p), p]));
    const portsB = new Map(snapB.data.map(p => [keyOf(p), p]));

    // Build process groups with diff status per port
    const groupMap = new Map<string, DiffProcessGroup>();

    const ensureGroup = (p: PortEntry): DiffProcessGroup => {
      const name = p.process_name ?? 'Unknown';
      const key = `${name}-${p.pid}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, { name, pid: p.pid, added: 0, removed: 0, unchanged: 0, ports: [] });
      }
      return groupMap.get(key)!;
    };

    let addedTotal = 0, removedTotal = 0, unchangedTotal = 0;

    // Ports in B but not A → added
    for (const [key, p] of portsB) {
      if (!portsA.has(key)) {
        const g = ensureGroup(p);
        g.added++;
        addedTotal++;
        g.ports.push({ port: p.local_port, process: p.process_name ?? 'Unknown', pid: p.pid, protocol: p.protocol, ip: p.local_ip, state: p.state ?? '', status: 'added' });
      }
    }

    // Ports in A but not B → removed
    for (const [key, p] of portsA) {
      if (!portsB.has(key)) {
        const g = ensureGroup(p);
        g.removed++;
        removedTotal++;
        g.ports.push({ port: p.local_port, process: p.process_name ?? 'Unknown', pid: p.pid, protocol: p.protocol, ip: p.local_ip, state: p.state ?? '', status: 'removed' });
      }
    }

    // Ports in both → unchanged (count only, not rendered)
    for (const [key, p] of portsA) {
      if (portsB.has(key)) {
        const g = ensureGroup(p);
        g.unchanged++;
        unchangedTotal++;
      }
    }

    // Sort groups: those with changes first
    const processGroups = Array.from(groupMap.values())
      .sort((a, b) => (b.added + b.removed) - (a.added + a.removed));

    const timeAgo = (iso: string): string => {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) { return 'just now'; }
      if (mins < 60) { return mins + ' min ago'; }
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) { return hrs + 'h ago'; }
      const days = Math.floor(hrs / 24);
      return days + 'd ago';
    };

    return {
      context: {
        nameA: snapA.name,
        nameB: isLiveCompare ? 'Current State' : snapB.name,
        ageA: timeAgo(snapA.createdAt),
        ageB: isLiveCompare ? 'now' : timeAgo(snapB.createdAt),
        isLiveCompare
      },
      summary: { addedPorts: addedTotal, removedPorts: removedTotal, unchangedPorts: unchangedTotal },
      processGroups
    };
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
