/**
 * Restart Manager - Intelligent auto-restart with exponential backoff
 * This is a KILLER FEATURE that PM2 doesn't do well
 */

import { EventEmitter } from 'events';
import { RestartPolicy } from '../types';
import { DEFAULT_RESTART_POLICY, CRASH_LOOP_THRESHOLD, CRASH_LOOP_WINDOW } from '../utils/constants';
import { calculateBackoffDelay, sleep } from '../utils/helpers';

interface RestartState {
  attempts: number;
  crashes: number[];
  lastRestartTime: number;
  inCrashLoop: boolean;
}

export class RestartManager extends EventEmitter {
  private states: Map<string, RestartState> = new Map();
  private policies: Map<string, RestartPolicy> = new Map();
  private restartTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Register a process for restart management
   */
  register(processId: string, policy?: Partial<RestartPolicy>): void {
    const fullPolicy: RestartPolicy = {
      ...DEFAULT_RESTART_POLICY,
      ...policy,
    };

    this.policies.set(processId, fullPolicy);
    this.states.set(processId, {
      attempts: 0,
      crashes: [],
      lastRestartTime: 0,
      inCrashLoop: false,
    });
  }

  /**
   * Unregister a process
   */
  unregister(processId: string): void {
    const timer = this.restartTimers.get(processId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(processId);
    }
    this.states.delete(processId);
    this.policies.delete(processId);
  }

  /**
   * Handle process exit and determine if restart is needed
   */
  async handleExit(
    processId: string,
    exitCode: number,
    signal?: string
  ): Promise<boolean> {
    const state = this.states.get(processId);
    const policy = this.policies.get(processId);

    if (!state || !policy) {
      return false;
    }

    // Record crash
    const now = Date.now();
    state.crashes.push(now);

    // Clean up old crashes outside the window
    state.crashes = state.crashes.filter(
      time => now - time < CRASH_LOOP_WINDOW * 1000
    );

    // Check for crash loop
    if (state.crashes.length >= CRASH_LOOP_THRESHOLD) {
      state.inCrashLoop = true;
      this.emit('crash-loop', {
        processId,
        crashes: state.crashes.length,
        window: CRASH_LOOP_WINDOW,
      });
      return false;
    }

    // Check if max restarts exceeded
    if (state.attempts >= policy.maxRestarts) {
      this.emit('max-restarts', {
        processId,
        attempts: state.attempts,
        max: policy.maxRestarts,
      });
      return false;
    }

    // Don't restart on clean exit (code 0)
    if (exitCode === 0 && !signal) {
      return false;
    }

    // Calculate delay with exponential backoff
    const delay = calculateBackoffDelay(
      state.attempts,
      policy.minDelay,
      policy.maxDelay
    );

    state.attempts++;
    state.lastRestartTime = now;

    this.emit('restart-scheduled', {
      processId,
      attempt: state.attempts,
      delay,
      exitCode,
      signal,
    });

    // Schedule restart
    await sleep(delay);

    return true;
  }

  /**
   * Reset restart state (called after successful restart)
   */
  resetAttempts(processId: string): void {
    const state = this.states.get(processId);
    if (state) {
      state.attempts = 0;
      state.inCrashLoop = false;
    }
  }

  /**
   * Get restart state for a process
   */
  getState(processId: string): RestartState | undefined {
    return this.states.get(processId);
  }

  /**
   * Check if process is in crash loop
   */
  isInCrashLoop(processId: string): boolean {
    const state = this.states.get(processId);
    return state?.inCrashLoop || false;
  }

  /**
   * Get crash count in current window
   */
  getCrashCount(processId: string): number {
    const state = this.states.get(processId);
    if (!state) return 0;

    const now = Date.now();
    return state.crashes.filter(
      time => now - time < CRASH_LOOP_WINDOW * 1000
    ).length;
  }
}
