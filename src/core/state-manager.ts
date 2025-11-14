/**
 * State Manager - Save and restore process state
 */

import { writeFile, readFile, rename } from 'fs/promises';
import { ProcessInfo, PersistedState } from '../types';
import { STATE_FILE, VERSION } from '../utils/constants';
import { fileExists, debounce } from '../utils/helpers';

export class StateManager {
  private saveDebounced: () => void;
  private getProcesses: () => ProcessInfo[];

  constructor(getProcessesFn: () => ProcessInfo[]) {
    this.getProcesses = getProcessesFn;
    this.saveDebounced = debounce(() => this.saveStateNow(), 1000);
  }

  /**
   * Save state (debounced)
   */
  saveState(): void {
    this.saveDebounced();
  }

  /**
   * Save state immediately
   */
  private async saveStateNow(): Promise<void> {
    try {
      const processes = this.getProcesses();
      
      const state: PersistedState = {
        version: VERSION,
        timestamp: Date.now(),
        processes,
      };

      const tempFile = `${STATE_FILE}.tmp`;
      await writeFile(tempFile, JSON.stringify(state, null, 2), 'utf-8');
      await rename(tempFile, STATE_FILE);
    } catch (error: any) {
      console.error('Failed to save state:', error.message);
    }
  }

  /**
   * Load state from file
   */
  async loadState(): Promise<ProcessInfo[]> {
    try {
      if (!(await fileExists(STATE_FILE))) {
        return [];
      }

      const content = await readFile(STATE_FILE, 'utf-8');
      const state: PersistedState = JSON.parse(content);

      // Validate structure
      if (!state.version || !state.processes || !Array.isArray(state.processes)) {
        console.error('Invalid state file structure');
        return [];
      }

      return state.processes;
    } catch (error: any) {
      console.error('Failed to load state:', error.message);
      
      // Backup corrupted file
      try {
        await rename(STATE_FILE, `${STATE_FILE}.backup`);
      } catch {
        // Ignore backup errors
      }
      
      return [];
    }
  }

  /**
   * Get state file path
   */
  getStatePath(): string {
    return STATE_FILE;
  }
}
