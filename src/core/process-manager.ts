/**
 * Process Manager Core
 * Central orchestrator for all process operations
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { ProcessConfig, ProcessInfo, ProcessStatus } from '../types';
import { ProcessRegistry } from './process-registry';
import { DEFAULT_PROCESS_CONFIG } from '../utils/constants';
import { fileExists } from '../utils/helpers';
import { resolve } from 'path';
import { LogManager } from '../components/log-manager';
import { RestartManager } from './restart-manager';
import { CrashReporter } from '../components/crash-reporter';
import { ResourceMonitor } from '../components/resource-monitor';
import { WatchManager } from '../components/watch-manager';
import { HealthChecker } from '../components/health-checker';

export class ProcessManager extends EventEmitter {
  private registry: ProcessRegistry;
  private processes: Map<string, ChildProcess>;
  private logManager: LogManager;
  private restartManager: RestartManager;
  private crashReporter: CrashReporter;
  private resourceMonitor: ResourceMonitor;
  private watchManager: WatchManager;
  private healthChecker: HealthChecker;

  constructor() {
    super();
    this.registry = new ProcessRegistry();
    this.processes = new Map();
    this.logManager = new LogManager();
    this.restartManager = new RestartManager();
    this.crashReporter = new CrashReporter();
    this.resourceMonitor = new ResourceMonitor();
    this.watchManager = new WatchManager();
    this.healthChecker = new HealthChecker();
    
    // Forward restart events
    this.restartManager.on('crash-loop', (data) => this.emit('crash-loop', data));
    this.restartManager.on('max-restarts', (data) => this.emit('max-restarts', data));
    this.restartManager.on('restart-scheduled', (data) => this.emit('restart-scheduled', data));
    
    // Forward resource events
    this.resourceMonitor.on('metrics', (data) => {
      this.updateMetrics(data.processId, data.cpu, data.memory);
    });
    this.resourceMonitor.on('threshold-exceeded', async (data) => {
      const processInfo = this.registry.get(data.processId);
      if (processInfo) {
        console.log(`Resource threshold exceeded for ${processInfo.name}: ${data.type} ${data.current}`);
        // Auto-restart on threshold violation
        try {
          await this.restartProcess(data.processId);
        } catch (error: any) {
          console.error(`Failed to restart process: ${error.message}`);
        }
      }
    });
    this.resourceMonitor.on('memory-warning', (data) => {
      console.log(`Memory warning for process ${data.processId}: ${data.percentage.toFixed(1)}% of limit`);
    });

    // Forward watch events
    this.watchManager.on('change', async (data) => {
      const processInfo = this.registry.get(data.processId);
      if (processInfo) {
        console.log(`File changed for ${processInfo.name}, restarting...`);
        try {
          await this.restartProcess(data.processId);
        } catch (error: any) {
          console.error(`Failed to restart on file change: ${error.message}`);
        }
      }
    });
  }

  /**
   * Start a new process
   */
  async startProcess(config: ProcessConfig): Promise<ProcessInfo> {
    // Validate script exists
    const scriptPath = resolve(config.cwd || process.cwd(), config.script);
    if (!(await fileExists(scriptPath))) {
      throw new Error(`Script not found: ${scriptPath}`);
    }

    // Apply defaults
    const fullConfig: ProcessConfig = {
      ...DEFAULT_PROCESS_CONFIG,
      ...config,
    };

    // Generate unique ID
    const id = this.registry.generateId();

    // Create process info
    const processInfo: ProcessInfo = {
      id,
      name: fullConfig.name,
      pid: 0, // Will be set after spawn
      status: 'starting',
      uptime: 0,
      restartCount: 0,
      cpu: 0,
      memory: 0,
      config: fullConfig,
      startTime: Date.now(),
    };

    // Add to registry
    this.registry.add(processInfo);

    try {
      // Spawn the process
      const childProcess = await this.spawnProcess(id, fullConfig);
      
      // Update PID
      processInfo.pid = childProcess.pid || 0;
      processInfo.status = 'running';

      // Store child process
      this.processes.set(id, childProcess);

      // Set up event handlers
      this.setupProcessHandlers(id, childProcess);

      // Attach log manager
      await this.logManager.attachToProcess(id, fullConfig.name, childProcess, fullConfig);

      // Register with restart manager
      this.restartManager.register(id, {
        maxRestarts: fullConfig.maxRestarts,
        minDelay: fullConfig.restartDelay,
      });

      // Start resource monitoring
      this.resourceMonitor.startMonitoring(
        id,
        processInfo.pid,
        fullConfig.memoryLimit,
        fullConfig.cpuLimit
      );

      // Start watching files if enabled
      if (fullConfig.watch) {
        this.watchManager.watchProcess(id, fullConfig);
      }

      // Check health if configured
      if (fullConfig.healthCheck) {
        const healthy = await this.healthChecker.waitForHealthy(id, fullConfig.healthCheck, 10000);
        if (!healthy) {
          console.warn(`Health check failed for ${fullConfig.name}, but process is running`);
        }
      }

      // Emit event
      this.emit('process:started', processInfo);

      return processInfo;
    } catch (error: any) {
      // Remove from registry on failure
      this.registry.remove(id);
      throw new Error(`Failed to start process: ${error.message}`);
    }
  }

  /**
   * Stop a process
   */
  async stopProcess(id: string): Promise<void> {
    const processInfo = this.registry.get(id);
    if (!processInfo) {
      throw new Error(`Process not found: ${id}`);
    }

    const childProcess = this.processes.get(id);
    if (!childProcess) {
      throw new Error(`Process not running: ${id}`);
    }

    // Update status
    processInfo.status = 'stopping';

    // Send SIGTERM
    childProcess.kill('SIGTERM');

    // Wait for process to exit or timeout
    await this.waitForExit(childProcess, 10000);

    // If still running, force kill
    if (!childProcess.killed) {
      childProcess.kill('SIGKILL');
    }

    // Clean up
    this.logManager.detach(id);
    this.restartManager.unregister(id);
    this.resourceMonitor.stopMonitoring(id);
    await this.watchManager.unwatchProcess(id);
    this.processes.delete(id);
    this.registry.remove(id);

    // Emit event
    this.emit('process:stopped', processInfo);
  }

  /**
   * Restart a process
   */
  async restartProcess(id: string): Promise<ProcessInfo> {
    const processInfo = this.registry.get(id);
    if (!processInfo) {
      throw new Error(`Process not found: ${id}`);
    }

    // Store config before stopping
    const config = { ...processInfo.config };
    const restartCount = processInfo.restartCount + 1;

    // Stop the process
    await this.stopProcess(id);

    // Start with same config
    const newProcessInfo = await this.startProcess(config);
    newProcessInfo.restartCount = restartCount;
    newProcessInfo.lastRestartTime = Date.now();
    newProcessInfo.lastRestartReason = 'manual';

    // Emit event
    this.emit('process:restarted', newProcessInfo);

    return newProcessInfo;
  }

  /**
   * Get process info
   */
  getProcess(id: string): ProcessInfo | undefined {
    return this.registry.get(id);
  }

  /**
   * Get process by name
   */
  getProcessByName(name: string): ProcessInfo | undefined {
    return this.registry.getByName(name);
  }

  /**
   * List all processes
   */
  listProcesses(): ProcessInfo[] {
    return this.registry.getAll();
  }

  /**
   * Delete a process from registry
   */
  async deleteProcess(id: string): Promise<void> {
    const processInfo = this.registry.get(id);
    if (!processInfo) {
      throw new Error(`Process not found: ${id}`);
    }

    // Stop if running
    if (this.processes.has(id)) {
      await this.stopProcess(id);
    } else {
      this.registry.remove(id);
    }

    // Emit event
    this.emit('process:deleted', processInfo);
  }

  /**
   * Spawn a child process
   */
  private async spawnProcess(id: string, config: ProcessConfig): Promise<ChildProcess> {
    const scriptPath = resolve(config.cwd || process.cwd(), config.script);

    // Prepare environment variables
    const env = {
      ...process.env,
      ...config.env,
    };

    // Spawn process
    const childProcess = spawn('node', [scriptPath, ...(config.args || [])], {
      cwd: config.cwd || process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, stdout/stderr piped
      detached: false,
    });

    if (!childProcess.pid) {
      throw new Error('Failed to spawn process');
    }

    return childProcess;
  }

  /**
   * Set up event handlers for a child process
   */
  private setupProcessHandlers(id: string, childProcess: ChildProcess): void {
    // Handle process exit
    childProcess.on('exit', async (code, signal) => {
      const processInfo = this.registry.get(id);
      if (!processInfo) return;

      processInfo.status = code === 0 ? 'stopped' : 'errored';
      
      // Record crash if non-zero exit
      if (code !== 0 || signal) {
        await this.crashReporter.recordCrash(
          id,
          processInfo.name,
          code || 0,
          signal || undefined,
          processInfo.cpu,
          processInfo.memory,
          processInfo.uptime,
          processInfo.restartCount
        );
      }
      
      this.emit('process:exit', {
        id,
        code,
        signal,
        processInfo,
      });

      // Clean up
      this.processes.delete(id);

      // Check if auto-restart is needed
      const shouldRestart = await this.restartManager.handleExit(
        id,
        code || 0,
        signal || undefined
      );

      if (shouldRestart) {
        try {
          processInfo.status = 'restarting';
          const config = { ...processInfo.config };
          
          // Stop and remove old process
          this.logManager.detach(id);
          this.registry.remove(id);
          
          // Start new process
          const newProcessInfo = await this.startProcess(config);
          newProcessInfo.restartCount = processInfo.restartCount + 1;
          newProcessInfo.lastRestartTime = Date.now();
          newProcessInfo.lastRestartReason = 'crash';
          
          // Reset restart attempts on successful restart
          this.restartManager.resetAttempts(newProcessInfo.id);
          
          this.emit('process:auto-restarted', newProcessInfo);
        } catch (error: any) {
          this.emit('process:restart-failed', {
            id,
            error: error.message,
          });
        }
      }
    });

    // Handle errors
    childProcess.on('error', (error) => {
      const processInfo = this.registry.get(id);
      if (processInfo) {
        processInfo.status = 'errored';
        this.emit('process:error', {
          id,
          error,
          processInfo,
        });
      }
    });

    // Capture stdout
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        this.emit('process:stdout', {
          id,
          data: data.toString(),
        });
      });
    }

    // Capture stderr
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        this.emit('process:stderr', {
          id,
          data: data.toString(),
        });
      });
    }
  }

  /**
   * Wait for process to exit
   */
  private waitForExit(childProcess: ChildProcess, timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, timeout);

      childProcess.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Update process uptime
   */
  updateUptime(id: string): void {
    const processInfo = this.registry.get(id);
    if (processInfo && processInfo.status === 'running') {
      processInfo.uptime = Date.now() - processInfo.startTime;
    }
  }

  /**
   * Update process metrics
   */
  updateMetrics(id: string, cpu: number, memory: number): void {
    const processInfo = this.registry.get(id);
    if (processInfo) {
      processInfo.cpu = cpu;
      processInfo.memory = memory;
    }
  }

  /**
   * Get logs for a process
   */
  async getLogs(id: string, lines: number = 100): Promise<string[]> {
    return await this.logManager.streamLogs(id, lines);
  }

  /**
   * Get crash report for a process
   */
  async getCrashReport(id: string): Promise<string> {
    return await this.crashReporter.generateReport(id);
  }

  /**
   * Get crash history for a process
   */
  async getCrashHistory(id: string, limit?: number) {
    return await this.crashReporter.getCrashHistory(id, limit);
  }
}
