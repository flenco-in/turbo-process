/**
 * Crash Reporter - Detailed crash analytics
 * KILLER FEATURE: PM2 just logs exit codes, we provide full crash analysis
 */

import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { CrashRecord } from '../types';
import { CRASHES_DIR, MAX_CRASH_RECORDS, CRASH_LOOP_THRESHOLD, CRASH_LOOP_WINDOW } from '../utils/constants';
import { ensureDir } from '../utils/helpers';

export class CrashReporter {
  /**
   * Record a crash with full details
   */
  async recordCrash(
    processId: string,
    processName: string,
    exitCode: number,
    signal: string | undefined,
    cpu: number,
    memory: number,
    uptime: number,
    restartCount: number
  ): Promise<void> {
    const crashRecord: CrashRecord = {
      timestamp: Date.now(),
      processId,
      processName,
      exitCode,
      signal,
      cpu,
      memory,
      uptime,
      restartCount,
    };

    try {
      await ensureDir(CRASHES_DIR);
      const crashFile = join(CRASHES_DIR, `${processId}.json`);

      // Load existing crashes
      let crashes: CrashRecord[] = [];
      try {
        const content = await readFile(crashFile, 'utf-8');
        crashes = JSON.parse(content);
      } catch {
        // File doesn't exist or is invalid
      }

      // Add new crash
      crashes.push(crashRecord);

      // Keep only last MAX_CRASH_RECORDS
      if (crashes.length > MAX_CRASH_RECORDS) {
        crashes = crashes.slice(-MAX_CRASH_RECORDS);
      }

      // Save
      await writeFile(crashFile, JSON.stringify(crashes, null, 2), 'utf-8');
    } catch (error: any) {
      console.error('Failed to record crash:', error.message);
    }
  }

  /**
   * Get crash history for a process
   */
  async getCrashHistory(processId: string, limit?: number): Promise<CrashRecord[]> {
    try {
      const crashFile = join(CRASHES_DIR, `${processId}.json`);
      const content = await readFile(crashFile, 'utf-8');
      const crashes: CrashRecord[] = JSON.parse(content);

      if (limit) {
        return crashes.slice(-limit);
      }

      return crashes;
    } catch {
      return [];
    }
  }

  /**
   * Check if process is in crash loop
   */
  async isInCrashLoop(processId: string): Promise<boolean> {
    const crashes = await this.getCrashHistory(processId);
    const now = Date.now();
    const recentCrashes = crashes.filter(
      crash => now - crash.timestamp < CRASH_LOOP_WINDOW * 1000
    );

    return recentCrashes.length >= CRASH_LOOP_THRESHOLD;
  }

  /**
   * Get crash statistics
   */
  async getCrashStats(processId: string): Promise<{
    total: number;
    recent: number;
    mostCommonExitCode: number;
    averageUptime: number;
    lastCrash?: CrashRecord;
  }> {
    const crashes = await this.getCrashHistory(processId);
    const now = Date.now();
    const recentCrashes = crashes.filter(
      crash => now - crash.timestamp < CRASH_LOOP_WINDOW * 1000
    );

    // Find most common exit code
    const exitCodes: Record<number, number> = {};
    crashes.forEach(crash => {
      exitCodes[crash.exitCode] = (exitCodes[crash.exitCode] || 0) + 1;
    });

    const mostCommonExitCode = Object.entries(exitCodes)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || 0;

    // Calculate average uptime
    const totalUptime = crashes.reduce((sum, crash) => sum + crash.uptime, 0);
    const averageUptime = crashes.length > 0 ? totalUptime / crashes.length : 0;

    return {
      total: crashes.length,
      recent: recentCrashes.length,
      mostCommonExitCode: parseInt(mostCommonExitCode.toString()),
      averageUptime,
      lastCrash: crashes[crashes.length - 1],
    };
  }

  /**
   * Generate crash report summary
   */
  async generateReport(processId: string): Promise<string> {
    const stats = await this.getCrashStats(processId);
    const crashes = await this.getCrashHistory(processId, 10);

    let report = `\n=== Crash Report ===\n`;
    report += `Total Crashes: ${stats.total}\n`;
    report += `Recent Crashes (60s): ${stats.recent}\n`;
    report += `Most Common Exit Code: ${stats.mostCommonExitCode}\n`;
    report += `Average Uptime: ${Math.round(stats.averageUptime / 1000)}s\n`;

    if (stats.lastCrash) {
      const date = new Date(stats.lastCrash.timestamp);
      report += `\nLast Crash: ${date.toISOString()}\n`;
      report += `  Exit Code: ${stats.lastCrash.exitCode}\n`;
      report += `  Signal: ${stats.lastCrash.signal || 'none'}\n`;
      report += `  Memory: ${Math.round(stats.lastCrash.memory / 1024 / 1024)}MB\n`;
      report += `  CPU: ${stats.lastCrash.cpu.toFixed(1)}%\n`;
      report += `  Uptime: ${Math.round(stats.lastCrash.uptime / 1000)}s\n`;
    }

    if (crashes.length > 0) {
      report += `\nRecent Crash Timeline:\n`;
      crashes.slice(-5).reverse().forEach(crash => {
        const date = new Date(crash.timestamp);
        report += `  ${date.toISOString()} - Exit ${crash.exitCode} - ${Math.round(crash.uptime / 1000)}s uptime\n`;
      });
    }

    return report;
  }
}
