/**
 * Core type definitions for TurboProcess
 */

export interface ProcessConfig {
  name: string;
  script: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  instances?: number | 'auto';
  watch?: boolean;
  watchIgnore?: string[];
  memoryLimit?: string; // e.g., "500mb"
  cpuLimit?: number; // percentage
  restartDelay?: number; // milliseconds
  maxRestarts?: number;
  healthCheck?: string; // URL
  logFormat?: 'text' | 'json';
  logOutput?: 'file' | 'stdout';
  metricsPort?: number;
}

export type ProcessStatus = 
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'errored'
  | 'restarting'
  | 'crashed';

export interface ProcessInfo {
  id: string;
  name: string;
  pid: number;
  status: ProcessStatus;
  uptime: number;
  restartCount: number;
  cpu: number;
  memory: number;
  config: ProcessConfig;
  startTime: number;
  lastRestartTime?: number;
  lastRestartReason?: string;
}

export interface CLICommand {
  action: string;
  target?: string;
  options?: Record<string, any>;
}

export interface CLIResponse {
  success: boolean;
  message: string;
  data?: any;
}

export interface RestartPolicy {
  maxRestarts: number;
  restartWindow: number; // seconds
  backoffStrategy: 'exponential' | 'linear';
  minDelay: number; // milliseconds
  maxDelay: number; // milliseconds
}

export interface ResourceMetrics {
  cpu: number; // percentage
  memory: number; // bytes
  timestamp: number;
}

export interface CrashRecord {
  timestamp: number;
  processId: string;
  processName: string;
  exitCode: number;
  signal?: string;
  cpu: number;
  memory: number;
  uptime: number;
  restartCount: number;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'warn';
  processId: string;
  processName: string;
  message: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  statusCode?: number;
  responseTime: number;
  error?: string;
}

export interface WorkerInfo {
  workerId: number;
  pid: number;
  status: 'starting' | 'healthy' | 'unhealthy' | 'stopping';
  startTime: number;
}

export interface ClusterInfo {
  masterId: string;
  workers: Map<number, WorkerInfo>;
  config: ProcessConfig;
}

export interface PersistedState {
  version: string;
  timestamp: number;
  processes: ProcessInfo[];
}

export interface ThresholdEvent {
  processId: string;
  type: 'memory' | 'cpu';
  current: number;
  limit: number;
}

export interface ChangeEvent {
  processId: string;
  filePath: string;
  changeType: 'add' | 'change' | 'unlink';
}
