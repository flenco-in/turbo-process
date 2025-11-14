/**
 * Resource Monitor - Intelligent CPU/Memory monitoring
 * KILLER FEATURE: PM2 misses memory leaks, we catch them!
 */

import { EventEmitter } from 'events';
import pidusage from 'pidusage';
import { ResourceMetrics, ThresholdEvent } from '../types';
import { 
  RESOURCE_MONITOR_INTERVAL, 
  MEMORY_CHECK_CONSECUTIVE, 
  CPU_CHECK_CONSECUTIVE,
  CPU_ROLLING_AVERAGE_SAMPLES,
  RESOURCE_HISTORY_SIZE,
  MEMORY_WARNING_THRESHOLD
} from '../utils/constants';
import { parseMemoryLimit } from '../utils/helpers';

interface MonitorState {
  pid: number;
  memoryLimit?: number;
  cpuLimit?: number;
  history: ResourceMetrics[];
  cpuSamples: number[];
  memoryExceededCount: number;
  cpuExceededCount: number;
  interval?: NodeJS.Timeout;
}

export class ResourceMonitor extends EventEmitter {
  private monitors: Map<string, MonitorState> = new Map();

  /**
   * Start monitoring a process
   */
  startMonitoring(
    processId: string,
    pid: number,
    memoryLimit?: string,
    cpuLimit?: number
  ): void {
    const state: MonitorState = {
      pid,
      memoryLimit: memoryLimit ? parseMemoryLimit(memoryLimit) : undefined,
      cpuLimit,
      history: [],
      cpuSamples: [],
      memoryExceededCount: 0,
      cpuExceededCount: 0,
    };

    this.monitors.set(processId, state);

    // Start polling
    state.interval = setInterval(() => {
      this.pollMetrics(processId);
    }, RESOURCE_MONITOR_INTERVAL);

    // Initial poll
    this.pollMetrics(processId);
  }

  /**
   * Stop monitoring a process
   */
  stopMonitoring(processId: string): void {
    const state = this.monitors.get(processId);
    if (state?.interval) {
      clearInterval(state.interval);
    }
    this.monitors.delete(processId);
  }

  /**
   * Get current metrics for a process
   */
  getMetrics(processId: string): ResourceMetrics | null {
    const state = this.monitors.get(processId);
    if (!state || state.history.length === 0) {
      return null;
    }
    return state.history[state.history.length - 1];
  }

  /**
   * Get metrics history
   */
  getHistory(processId: string): ResourceMetrics[] {
    const state = this.monitors.get(processId);
    return state?.history || [];
  }

  /**
   * Poll metrics for a process
   */
  private async pollMetrics(processId: string): Promise<void> {
    const state = this.monitors.get(processId);
    if (!state) return;

    try {
      const stats = await pidusage(state.pid);

      const metrics: ResourceMetrics = {
        cpu: stats.cpu,
        memory: stats.memory,
        timestamp: Date.now(),
      };

      // Add to history
      state.history.push(metrics);
      if (state.history.length > RESOURCE_HISTORY_SIZE) {
        state.history.shift();
      }

      // Calculate rolling average for CPU
      state.cpuSamples.push(metrics.cpu);
      if (state.cpuSamples.length > CPU_ROLLING_AVERAGE_SAMPLES) {
        state.cpuSamples.shift();
      }

      const avgCpu = state.cpuSamples.reduce((a, b) => a + b, 0) / state.cpuSamples.length;

      // Emit metrics update
      this.emit('metrics', {
        processId,
        cpu: avgCpu,
        memory: metrics.memory,
      });

      // Check memory threshold
      if (state.memoryLimit) {
        if (metrics.memory >= state.memoryLimit) {
          state.memoryExceededCount++;

          // Warn at 80%
          if (metrics.memory >= state.memoryLimit * MEMORY_WARNING_THRESHOLD) {
            this.emit('memory-warning', {
              processId,
              current: metrics.memory,
              limit: state.memoryLimit,
              percentage: (metrics.memory / state.memoryLimit) * 100,
            });
          }

          // Trigger restart after consecutive violations
          if (state.memoryExceededCount >= MEMORY_CHECK_CONSECUTIVE) {
            const event: ThresholdEvent = {
              processId,
              type: 'memory',
              current: metrics.memory,
              limit: state.memoryLimit,
            };
            this.emit('threshold-exceeded', event);
            state.memoryExceededCount = 0; // Reset
          }
        } else {
          state.memoryExceededCount = 0;
        }
      }

      // Check CPU threshold
      if (state.cpuLimit && avgCpu >= state.cpuLimit) {
        state.cpuExceededCount++;

        if (state.cpuExceededCount >= CPU_CHECK_CONSECUTIVE) {
          const event: ThresholdEvent = {
            processId,
            type: 'cpu',
            current: avgCpu,
            limit: state.cpuLimit,
          };
          this.emit('threshold-exceeded', event);
          state.cpuExceededCount = 0; // Reset
        }
      } else {
        state.cpuExceededCount = 0;
      }
    } catch (error: any) {
      // Process might have exited
      if (error.code === 'ENOENT' || error.message.includes('No such process')) {
        this.stopMonitoring(processId);
      }
    }
  }
}
