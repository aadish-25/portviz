import { PortEntry } from './report';

export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  portCount: number;
  publicCount: number;
  processCount: number;
  data: PortEntry[];
}

export interface DiffPortEntry {
  port: number;
  process: string;
  pid: number;
  protocol: string;
  ip: string;
  state: string;
  status: 'added' | 'removed' | 'unchanged';
}

export interface DiffProcessGroup {
  name: string;
  pid: number;
  added: number;
  removed: number;
  unchanged: number;
  ports: DiffPortEntry[];
}

export interface SnapshotDiff {
  context: {
    nameA: string;
    nameB: string;
    ageA: string;
    ageB: string;
    isLiveCompare: boolean;
  };
  summary: {
    addedPorts: number;
    removedPorts: number;
    unchangedPorts: number;
  };
  processGroups: DiffProcessGroup[];
}
