/**
 * Log Manager - Captures, formats, rotates, and streams process logs
 */

import { createWriteStream, WriteStream, statSync } from 'fs';
import { readFile, rename, unlink } from 'fs/promises';
import { join } from 'path';
import { ChildProcess } from 'child_process';
import { LogEntry, ProcessConfig } from '../types';
import { LOGS_DIR, LOG_MAX_SIZE, LOG_MAX_FILES } from '../utils/constants';
import { ensureDir, formatTimestamp } from '../utils/helpers';

export class LogManager {
  private streams: Map<string, WriteStream> = new Map();
  private logPaths: Map<string, string> = new Map();

  /**
   * Attach to a process and capture its output
   */
  async attachToProcess(
    processId: string,
    processName: string,
    childProcess: ChildProcess,
    config: ProcessConfig
  ): Promise<void> {
    const logDir = join(LOGS_DIR, processId);
    await ensureDir(logDir);

    const logPath = join(logDir, 'app.log');
    this.logPaths.set(processId, logPath);

    const stream = createWriteStream(logPath, { flags: 'a' });
    this.streams.set(processId, stream);

    const logFormat = config.logFormat || 'text';
    const logOutput = config.logOutput || 'file';

    // Capture stdout
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        const message = data.toString();
        this.writeLog(processId, processName, 'info', message, logFormat, logOutput);
      });
    }

    // Capture stderr
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        const message = data.toString();
        this.writeLog(processId, processName, 'error', message, logFormat, logOutput);
      });
    }
  }

  /**
   * Detach from a process
   */
  detach(processId: string): void {
    const stream = this.streams.get(processId);
    if (stream) {
      stream.end();
      this.streams.delete(processId);
    }
    this.logPaths.delete(processId);
  }

  /**
   * Get log file path
   */
  getLogPath(processId: string): string | undefined {
    return this.logPaths.get(processId);
  }

  /**
   * Stream logs (read last N lines)
   */
  async streamLogs(processId: string, lines: number = 100): Promise<string[]> {
    const logPath = this.logPaths.get(processId);
    if (!logPath) {
      return [];
    }

    try {
      const content = await readFile(logPath, 'utf-8');
      const allLines = content.split('\n').filter(line => line.trim());
      return allLines.slice(-lines);
    } catch {
      return [];
    }
  }

  /**
   * Write a log entry
   */
  private writeLog(
    processId: string,
    processName: string,
    level: 'info' | 'error' | 'warn',
    message: string,
    format: 'text' | 'json',
    output: 'file' | 'stdout'
  ): void {
    const timestamp = formatTimestamp();
    let logLine: string;

    if (format === 'json') {
      const entry: LogEntry = {
        timestamp,
        level,
        processId,
        processName,
        message: message.trim(),
      };
      logLine = JSON.stringify(entry) + '\n';
    } else {
      logLine = `[${timestamp}] [${level.toUpperCase()}] [${processName}] ${message}`;
      if (!logLine.endsWith('\n')) {
        logLine += '\n';
      }
    }

    // Write to file
    if (output === 'file') {
      const stream = this.streams.get(processId);
      if (stream && !stream.destroyed) {
        stream.write(logLine);
        this.checkRotation(processId);
      }
    }

    // Write to stdout
    if (output === 'stdout') {
      process.stdout.write(logLine);
    }
  }

  /**
   * Check if log rotation is needed
   */
  private checkRotation(processId: string): void {
    const logPath = this.logPaths.get(processId);
    if (!logPath) return;

    try {
      const stats = statSync(logPath);
      if (stats.size >= LOG_MAX_SIZE) {
        this.rotateLogs(processId);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Rotate log files
   */
  private async rotateLogs(processId: string): Promise<void> {
    const logPath = this.logPaths.get(processId);
    if (!logPath) return;

    const stream = this.streams.get(processId);
    if (stream) {
      stream.end();
    }

    try {
      // Rotate existing files
      for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
        const oldPath = i === 1 ? logPath : `${logPath}.${i}`;
        const newPath = `${logPath}.${i + 1}`;

        try {
          await rename(oldPath, newPath);
        } catch {
          // File doesn't exist, continue
        }
      }

      // Delete oldest file if it exists
      try {
        await unlink(`${logPath}.${LOG_MAX_FILES}`);
      } catch {
        // File doesn't exist
      }

      // Rename current log to .1
      await rename(logPath, `${logPath}.1`);

      // Create new stream
      const newStream = createWriteStream(logPath, { flags: 'a' });
      this.streams.set(processId, newStream);
    } catch (error) {
      console.error('Error rotating logs:', error);
    }
  }
}
