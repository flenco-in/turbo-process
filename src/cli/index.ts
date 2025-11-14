#!/usr/bin/env node

/**
 * TurboProcess CLI entry point
 */

import { Command } from 'commander';
import { VERSION } from '../utils/constants';
import { IPCClient } from './ipc-client';
import { CLICommand, ProcessInfo } from '../types';
import Table from 'cli-table3';
import chalk from 'chalk';

const program = new Command();
const ipcClient = new IPCClient();

/**
 * Send command to daemon and handle response
 */
async function sendCommand(command: CLICommand): Promise<void> {
  try {
    const response = await ipcClient.sendCommand(command);
    
    if (response.success) {
      // Special handling for status command
      if (command.action === 'status' && Array.isArray(response.data)) {
        displayStatusTable(response.data);
        return;
      }

      console.log(response.message);
      if (response.data) {
        // Special handling for logs command
        if (command.action === 'logs' && Array.isArray(response.data)) {
          response.data.forEach(line => console.log(line));
        } else {
          console.log(JSON.stringify(response.data, null, 2));
        }
      }
    } else {
      console.error(chalk.red('Error:'), response.message);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(chalk.red('Failed to communicate with daemon:'), error.message);
    process.exit(2);
  }
}

/**
 * Display beautiful status table (KILLER FEATURE - way better than PM2!)
 */
function displayStatusTable(processes: ProcessInfo[]): void {
  if (processes.length === 0) {
    console.log(chalk.yellow('No processes running'));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan('ID'),
      chalk.cyan('Name'),
      chalk.cyan('Status'),
      chalk.cyan('↻'),
      chalk.cyan('CPU'),
      chalk.cyan('Memory'),
      chalk.cyan('Uptime'),
    ],
    style: {
      head: [],
      border: ['grey'],
    },
  });

  processes.forEach(proc => {
    // Format status with colors
    let statusText: string = proc.status;
    let statusColor = chalk.white;
    
    switch (proc.status) {
      case 'running':
        statusColor = chalk.green;
        statusText = '● running';
        break;
      case 'stopped':
        statusColor = chalk.gray;
        statusText = '○ stopped';
        break;
      case 'errored':
        statusColor = chalk.red;
        statusText = '✖ errored';
        break;
      case 'restarting':
        statusColor = chalk.yellow;
        statusText = '↻ restarting';
        break;
    }

    // Format uptime
    const uptimeMs = proc.uptime;
    const uptimeStr = formatUptime(uptimeMs);

    // Format memory
    const memoryMB = Math.round(proc.memory / 1024 / 1024);
    const memoryStr = memoryMB > 0 ? `${memoryMB} MB` : '-';

    // Format CPU
    const cpuStr = proc.cpu > 0 ? `${proc.cpu.toFixed(1)}%` : '-';

    // Restart count with color
    let restartStr = proc.restartCount.toString();
    if (proc.restartCount > 5) {
      restartStr = chalk.red(restartStr);
    } else if (proc.restartCount > 0) {
      restartStr = chalk.yellow(restartStr);
    }

    table.push([
      proc.id.substring(0, 10),
      proc.name,
      statusColor(statusText),
      restartStr,
      cpuStr,
      memoryStr,
      uptimeStr,
    ]);
  });

  console.log(table.toString());
  console.log(chalk.gray(`\nTotal: ${processes.length} process(es)`));
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

program
  .name('turbo')
  .description('A modern, lightweight process manager for Node.js applications')
  .version(VERSION);

// Start command
program
  .command('start <script>')
  .description('Start a process from a script file or config file')
  .option('-n, --name <name>', 'Process name')
  .option('-i, --instances <number>', 'Number of instances (or "auto")')
  .option('-w, --watch', 'Enable watch mode')
  .option('--env <vars...>', 'Environment variables (KEY=VALUE)')
  .action(async (script: string, options: any) => {
    await sendCommand({
      action: 'start',
      target: script,
      options,
    });
  });

// Stop command
program
  .command('stop <target>')
  .description('Stop a process by ID, name, or "all"')
  .action(async (target: string) => {
    await sendCommand({
      action: 'stop',
      target,
    });
  });

// Restart command
program
  .command('restart <target>')
  .description('Restart a process by ID, name, or "all"')
  .option('--zero-downtime', 'Perform zero-downtime restart (cluster mode only)')
  .action(async (target: string, options: any) => {
    await sendCommand({
      action: 'restart',
      target,
      options,
    });
  });

// Status command
program
  .command('status')
  .description('Show status of all managed processes')
  .action(async () => {
    await sendCommand({
      action: 'status',
    });
  });

// Logs command
program
  .command('logs <target>')
  .description('Stream logs from a process')
  .option('-n, --lines <number>', 'Number of lines to show', '100')
  .option('-f, --follow', 'Follow log output')
  .action(async (target: string, options: any) => {
    await sendCommand({
      action: 'logs',
      target,
      options,
    });
  });

// Monitor command
program
  .command('monitor')
  .description('Open real-time monitoring dashboard')
  .action(async () => {
    await sendCommand({
      action: 'monitor',
    });
  });

// Save command
program
  .command('save')
  .description('Save current process state')
  .action(async () => {
    await sendCommand({
      action: 'save',
    });
  });

// Delete command
program
  .command('delete <target>')
  .description('Remove a process from registry')
  .action(async (target: string) => {
    await sendCommand({
      action: 'delete',
      target,
    });
  });

// Startup command
program
  .command('startup')
  .description('Enable auto-start on system boot')
  .action(async () => {
    await sendCommand({
      action: 'startup',
    });
  });

// Unstartup command
program
  .command('unstartup')
  .description('Disable auto-start on system boot')
  .action(async () => {
    await sendCommand({
      action: 'unstartup',
    });
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
