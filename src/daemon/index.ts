/**
 * TurboProcess Daemon entry point
 */

import { IPCServer } from './ipc-server';
import { CLICommand, CLIResponse, ProcessConfig } from '../types';
import { DAEMON_PID_FILE, DAEMON_LOG_FILE, TURBO_HOME } from '../utils/constants';
import { ensureDir, fileExists } from '../utils/helpers';
import { writeFile, unlink, appendFile } from 'fs/promises';
import { createWriteStream, WriteStream } from 'fs';
import { ProcessManager } from '../core/process-manager';
import { ConfigParser } from '../utils/config-parser';
import { StateManager } from '../core/state-manager';

export class Daemon {
  private ipcServer: IPCServer;
  private processManager: ProcessManager;
  private stateManager: StateManager;
  private logStream: WriteStream | null = null;
  private isShuttingDown = false;
  private shutdownTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.ipcServer = new IPCServer();
    this.processManager = new ProcessManager();
    this.stateManager = new StateManager(() => this.processManager.listProcesses());
  }

  async start(): Promise<void> {
    this.log('Daemon starting...');
    
    // Ensure TurboProcess home directory exists
    await ensureDir(TURBO_HOME);
    
    // Check if daemon is already running
    if (await this.isDaemonRunning()) {
      throw new Error('Daemon is already running');
    }
    
    // Set up daemon logging
    await this.setupLogging();
    
    // Write PID file
    await this.writePidFile();
    
    // Start IPC server
    await this.ipcServer.start(this.handleCommand.bind(this));
    
    // Load and restore previous state
    await this.restoreState();
    
    // Listen for process changes to save state
    this.processManager.on('process:started', () => this.stateManager.saveState());
    this.processManager.on('process:stopped', () => this.stateManager.saveState());
    this.processManager.on('process:restarted', () => this.stateManager.saveState());
    
    this.log('Daemon started successfully');
    this.log(`PID: ${process.pid}`);
  }

  async stop(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.log('Daemon stopping...');
    
    // Set shutdown timeout (10 seconds)
    this.shutdownTimeout = setTimeout(() => {
      this.log('Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, 10000);
    
    try {
      // Stop IPC server
      await this.ipcServer.stop();
      
      // Remove PID file
      await this.removePidFile();
      
      // Close log stream
      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }
      
      this.log('Daemon stopped');
      
      // Clear shutdown timeout
      if (this.shutdownTimeout) {
        clearTimeout(this.shutdownTimeout);
      }
    } catch (error: any) {
      this.log(`Error during shutdown: ${error.message}`);
      throw error;
    }
  }

  /**
   * Set up daemon logging to file
   */
  private async setupLogging(): Promise<void> {
    try {
      this.logStream = createWriteStream(DAEMON_LOG_FILE, { flags: 'a' });
      
      // Redirect console.log to log file
      const originalLog = console.log;
      const originalError = console.error;
      
      console.log = (...args: any[]) => {
        this.log(args.join(' '));
        originalLog(...args);
      };
      
      console.error = (...args: any[]) => {
        this.log(`ERROR: ${args.join(' ')}`);
        originalError(...args);
      };
    } catch (error: any) {
      console.error('Failed to set up logging:', error.message);
    }
  }

  /**
   * Write a log entry
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    
    if (this.logStream && !this.logStream.destroyed) {
      this.logStream.write(logLine);
    }
  }

  /**
   * Write PID file
   */
  private async writePidFile(): Promise<void> {
    await writeFile(DAEMON_PID_FILE, process.pid.toString(), 'utf-8');
  }

  /**
   * Remove PID file
   */
  private async removePidFile(): Promise<void> {
    try {
      if (await fileExists(DAEMON_PID_FILE)) {
        await unlink(DAEMON_PID_FILE);
      }
    } catch (error: any) {
      this.log(`Failed to remove PID file: ${error.message}`);
    }
  }

  /**
   * Check if daemon is already running
   */
  private async isDaemonRunning(): Promise<boolean> {
    try {
      if (!(await fileExists(DAEMON_PID_FILE))) {
        return false;
      }

      const { readFile } = await import('fs/promises');
      const pidStr = await readFile(DAEMON_PID_FILE, 'utf-8');
      const pid = parseInt(pidStr.trim(), 10);

      if (isNaN(pid)) {
        return false;
      }

      // Check if process is running
      try {
        process.kill(pid, 0); // Signal 0 checks if process exists
        return true;
      } catch {
        // Process not running, clean up stale PID file
        await this.removePidFile();
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Handle commands from CLI
   */
  private async handleCommand(command: CLICommand): Promise<CLIResponse> {
    this.log(`Received command: ${command.action}`);

    try {
      // Handle ping command for health check
      if (command.action === 'ping') {
        return {
          success: true,
          message: 'pong',
        };
      }

      switch (command.action) {
        case 'start':
          return await this.handleStart(command);
        
        case 'stop':
          return await this.handleStop(command);
        
        case 'restart':
          return await this.handleRestart(command);
        
        case 'status':
          return await this.handleStatus();
        
        case 'logs':
          return await this.handleLogs(command);
        
        case 'save':
          return await this.handleSave();
        
        case 'delete':
          return await this.handleDelete(command);
        
        case 'startup':
          return await this.handleStartup();
        
        case 'unstartup':
          return await this.handleUnstartup();
        
        default:
          return {
            success: false,
            message: `Unknown command: ${command.action}`,
          };
      }
    } catch (error: any) {
      this.log(`Error handling command ${command.action}: ${error.message}`);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Handle start command
   */
  private async handleStart(command: CLICommand): Promise<CLIResponse> {
    const target = command.target;
    if (!target) {
      return {
        success: false,
        message: 'Script path or config file is required',
      };
    }

    // Check if target is a config file (YAML)
    const isYamlFile = target.endsWith('.yml') || target.endsWith('.yaml');
    
    if (isYamlFile) {
      const exists = await fileExists(target);
      if (exists) {
        return await this.handleStartFromConfig(target);
      }
    }

    // Start single process from script
    const options = command.options || {};
    
    // Build process config
    const config: ProcessConfig = {
      name: options.name || target,
      script: target,
      args: options.args,
      env: this.parseEnvVars(options.env),
      instances: options.instances === 'auto' ? 'auto' : (options.instances ? parseInt(options.instances, 10) : undefined),
      watch: options.watch,
    };

    const processInfo = await this.processManager.startProcess(config);

    return {
      success: true,
      message: `Process started: ${processInfo.name} (${processInfo.id})`,
      data: processInfo,
    };
  }

  /**
   * Handle start from config file
   */
  private async handleStartFromConfig(configPath: string): Promise<CLIResponse> {
    const parser = new ConfigParser();
    
    try {
      const configs = await parser.parseConfigFile(configPath);
      const started = [];

      for (const config of configs) {
        const processInfo = await this.processManager.startProcess(config);
        started.push(processInfo);
      }

      return {
        success: true,
        message: `Started ${started.length} process(es) from config`,
        data: started,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to start from config: ${error.message}`,
      };
    }
  }

  /**
   * Handle stop command
   */
  private async handleStop(command: CLICommand): Promise<CLIResponse> {
    const target = command.target;
    if (!target) {
      return {
        success: false,
        message: 'Process ID or name is required',
      };
    }

    if (target === 'all') {
      // Stop all processes
      const processes = this.processManager.listProcesses();
      for (const proc of processes) {
        await this.processManager.stopProcess(proc.id);
      }
      return {
        success: true,
        message: `Stopped ${processes.length} process(es)`,
      };
    }

    // Try to find by ID first, then by name
    let processInfo = this.processManager.getProcess(target);
    if (!processInfo) {
      processInfo = this.processManager.getProcessByName(target);
    }

    if (!processInfo) {
      return {
        success: false,
        message: `Process not found: ${target}`,
      };
    }

    await this.processManager.stopProcess(processInfo.id);

    return {
      success: true,
      message: `Process stopped: ${processInfo.name} (${processInfo.id})`,
    };
  }

  /**
   * Handle restart command
   */
  private async handleRestart(command: CLICommand): Promise<CLIResponse> {
    const target = command.target;
    if (!target) {
      return {
        success: false,
        message: 'Process ID or name is required',
      };
    }

    const options = command.options || {};
    const zeroDowntime = options.zeroDowntime || false;

    if (target === 'all') {
      // Restart all processes
      const processes = this.processManager.listProcesses();
      const restarted = [];
      for (const proc of processes) {
        let newProc;
        if (zeroDowntime) {
          try {
            newProc = await this.processManager.restartZeroDowntime(proc.id);
          } catch (error: any) {
            // Fall back to regular restart if not clustered
            newProc = await this.processManager.restartProcess(proc.id);
          }
        } else {
          newProc = await this.processManager.restartProcess(proc.id);
        }
        restarted.push(newProc);
      }
      return {
        success: true,
        message: `Restarted ${restarted.length} process(es)${zeroDowntime ? ' with zero-downtime' : ''}`,
        data: restarted,
      };
    }

    // Try to find by ID first, then by name
    let processInfo = this.processManager.getProcess(target);
    if (!processInfo) {
      processInfo = this.processManager.getProcessByName(target);
    }

    if (!processInfo) {
      return {
        success: false,
        message: `Process not found: ${target}`,
      };
    }

    let newProcessInfo;
    if (zeroDowntime) {
      try {
        newProcessInfo = await this.processManager.restartZeroDowntime(processInfo.id);
      } catch (error: any) {
        return {
          success: false,
          message: error.message,
        };
      }
    } else {
      newProcessInfo = await this.processManager.restartProcess(processInfo.id);
    }

    return {
      success: true,
      message: `Process restarted: ${newProcessInfo.name} (${newProcessInfo.id})${zeroDowntime ? ' with zero-downtime' : ''}`,
      data: newProcessInfo,
    };
  }

  /**
   * Handle status command
   */
  private async handleStatus(): Promise<CLIResponse> {
    const processes = this.processManager.listProcesses();

    // Update uptime for all running processes
    for (const proc of processes) {
      this.processManager.updateUptime(proc.id);
    }

    return {
      success: true,
      message: `Found ${processes.length} process(es)`,
      data: processes,
    };
  }

  /**
   * Handle delete command
   */
  private async handleDelete(command: CLICommand): Promise<CLIResponse> {
    const target = command.target;
    if (!target) {
      return {
        success: false,
        message: 'Process ID or name is required',
      };
    }

    // Try to find by ID first, then by name
    let processInfo = this.processManager.getProcess(target);
    if (!processInfo) {
      processInfo = this.processManager.getProcessByName(target);
    }

    if (!processInfo) {
      return {
        success: false,
        message: `Process not found: ${target}`,
      };
    }

    await this.processManager.deleteProcess(processInfo.id);

    return {
      success: true,
      message: `Process deleted: ${processInfo.name} (${processInfo.id})`,
    };
  }

  /**
   * Handle logs command
   */
  private async handleLogs(command: CLICommand): Promise<CLIResponse> {
    const target = command.target;
    if (!target) {
      return {
        success: false,
        message: 'Process ID or name is required',
      };
    }

    const options = command.options || {};
    const lines = parseInt(options.lines || '100', 10);

    // Find process
    let processInfo = this.processManager.getProcess(target);
    if (!processInfo) {
      processInfo = this.processManager.getProcessByName(target);
    }

    if (!processInfo) {
      return {
        success: false,
        message: `Process not found: ${target}`,
      };
    }

    const logs = await this.processManager.getLogs(processInfo.id, lines);

    return {
      success: true,
      message: `Showing last ${logs.length} lines`,
      data: logs,
    };
  }

  /**
   * Restore state from previous session
   */
  private async restoreState(): Promise<void> {
    const processes = await this.stateManager.loadState();
    this.log(`Restoring ${processes.length} process(es) from previous session`);
    
    for (const proc of processes) {
      if (proc.status === 'running') {
        try {
          await this.processManager.startProcess(proc.config);
          this.log(`Restored process: ${proc.name}`);
        } catch (error: any) {
          this.log(`Failed to restore process ${proc.name}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Handle save command
   */
  private async handleSave(): Promise<CLIResponse> {
    this.stateManager.saveState();
    return {
      success: true,
      message: 'State saved successfully',
    };
  }

  /**
   * Handle startup command
   */
  private async handleStartup(): Promise<CLIResponse> {
    try {
      const { StartupManager } = await import('../utils/startup-manager');
      const message = await StartupManager.setupStartup();
      return {
        success: true,
        message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to enable startup: ${error.message}`,
      };
    }
  }

  /**
   * Handle unstartup command
   */
  private async handleUnstartup(): Promise<CLIResponse> {
    try {
      const { StartupManager } = await import('../utils/startup-manager');
      const message = await StartupManager.removeStartup();
      return {
        success: true,
        message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to disable startup: ${error.message}`,
      };
    }
  }

  /**
   * Parse environment variables from CLI format
   */
  private parseEnvVars(envArray?: string[]): Record<string, string> | undefined {
    if (!envArray || envArray.length === 0) {
      return undefined;
    }

    const env: Record<string, string> = {};
    for (const item of envArray) {
      const [key, ...valueParts] = item.split('=');
      if (key) {
        env[key] = valueParts.join('=');
      }
    }
    return env;
  }
}

// Start daemon if run directly
if (require.main === module) {
  const daemon = new Daemon();
  
  daemon.start().catch((error) => {
    console.error('Failed to start daemon:', error);
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    await daemon.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await daemon.stop();
    process.exit(0);
  });
}
