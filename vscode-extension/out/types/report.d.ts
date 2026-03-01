export interface PortEntry {
    protocol: string;
    local_ip: string;
    local_port: number;
    foreign_ip: string;
    foreign_port: number | string | null;
    state: string | null;
    pid: number;
    process_name: string | null;
}
export type PortvizReport = PortEntry[];
//# sourceMappingURL=report.d.ts.map