import { PortEntry } from '../types/report';

export interface ProcessGroup {
  type: 'process';
  name: string;
  pid: number;
  ports: PortEntry[];
}

export interface PortLeaf {
  type: 'port';
  entry: PortEntry;
}

export type PortNode = ProcessGroup | PortLeaf;