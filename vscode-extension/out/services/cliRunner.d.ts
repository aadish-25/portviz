import { PortvizReport } from '../types/report';
export interface CliResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    exitCode: number;
}
export declare class CliRunner {
    runReport(): Promise<CliResult<PortvizReport>>;
}
//# sourceMappingURL=cliRunner.d.ts.map