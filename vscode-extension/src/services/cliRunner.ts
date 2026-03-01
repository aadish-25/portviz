import { PortvizReport } from "../types/report";

export interface cliResult<T>{
    success: boolean,
    data?: T,
    error?:string,
    exitCode: number;
}

export class cliRunner {
    runReport(): Promise<cliResult<PortvizReport>>{
        
    }
}