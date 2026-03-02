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

export interface SnapshotDiff {
  addedPorts: { port: number; process: string; protocol: string; ip: string }[];
  removedPorts: { port: number; process: string; protocol: string; ip: string }[];
  addedProcesses: string[];
  removedProcesses: string[];
  unchangedPorts: number;
}
