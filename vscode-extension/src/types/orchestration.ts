export type ServiceRole = 'frontend' | 'backend' | 'database' | 'cache' | 'custom';
export type ServiceStatus = 'running' | 'stopped' | 'starting' | 'error';

export interface Service {
  id: string;
  name: string;
  role: ServiceRole;
  port?: number;
  startCommands: string[];
  workingDirectory: string;
  autoDetected: boolean;
  linkedPid?: number;
  /** Optional environment variables applied when starting the service */
  envVars?: Record<string, string>;
  /** Optional logical group/stack name for bulk operations */
  group?: string;
}

export interface ServiceState extends Service {
  status: ServiceStatus;
}

export interface DetectedService {
  name: string;
  role: ServiceRole;
  port: number;
  pid: number;
  processName: string;
  framework?: string;
}

/** Port → role + hint mapping for auto-detection */
export const PORT_ROLE_MAP: Record<number, { role: ServiceRole; framework: string }> = {
  // Frontend
  3000: { role: 'frontend', framework: 'React / Next.js' },
  3001: { role: 'frontend', framework: 'React (alt)' },
  4200: { role: 'frontend', framework: 'Angular' },
  5173: { role: 'frontend', framework: 'Vite' },
  5174: { role: 'frontend', framework: 'Vite (alt)' },
  8080: { role: 'frontend', framework: 'Vue / Webpack Dev Server' },
  4321: { role: 'frontend', framework: 'Astro' },
  // Backend
  5000: { role: 'backend', framework: 'Flask / Express' },
  8000: { role: 'backend', framework: 'Django / Uvicorn' },
  8001: { role: 'backend', framework: 'FastAPI (alt)' },
  4000: { role: 'backend', framework: 'GraphQL / NestJS' },
  9000: { role: 'backend', framework: 'PHP-FPM' },
  // Database
  5432: { role: 'database', framework: 'PostgreSQL' },
  3306: { role: 'database', framework: 'MySQL' },
  27017: { role: 'database', framework: 'MongoDB' },
  1433: { role: 'database', framework: 'SQL Server' },
  // Cache
  6379: { role: 'cache', framework: 'Redis' },
  11211: { role: 'cache', framework: 'Memcached' },
};

/** Process name → role + hint mapping */
export const PROCESS_HINTS: Record<string, { role: ServiceRole; framework: string }> = {
  'node': { role: 'backend', framework: 'Node.js' },
  'node.exe': { role: 'backend', framework: 'Node.js' },
  'python': { role: 'backend', framework: 'Python' },
  'python.exe': { role: 'backend', framework: 'Python' },
  'python3': { role: 'backend', framework: 'Python' },
  'uvicorn': { role: 'backend', framework: 'Uvicorn' },
  'gunicorn': { role: 'backend', framework: 'Gunicorn' },
  'java': { role: 'backend', framework: 'Java' },
  'java.exe': { role: 'backend', framework: 'Java' },
  'postgres': { role: 'database', framework: 'PostgreSQL' },
  'postgres.exe': { role: 'database', framework: 'PostgreSQL' },
  'mysqld': { role: 'database', framework: 'MySQL' },
  'mysqld.exe': { role: 'database', framework: 'MySQL' },
  'mongod': { role: 'database', framework: 'MongoDB' },
  'mongod.exe': { role: 'database', framework: 'MongoDB' },
  'redis-server': { role: 'cache', framework: 'Redis' },
  'redis-server.exe': { role: 'cache', framework: 'Redis' },
};
