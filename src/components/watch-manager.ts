/**
 * Watch Manager - File change detection for auto-restart
 */

import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { ProcessConfig, ChangeEvent } from '../types';
import { WATCH_DEBOUNCE_DELAY } from '../utils/constants';
import { debounce } from '../utils/helpers';
import { dirname, resolve } from 'path';

export class WatchManager extends EventEmitter {
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private debouncedRestarts: Map<string, () => void> = new Map();

  /**
   * Start watching files for a process
   */
  watchProcess(processId: string, config: ProcessConfig): void {
    if (!config.watch) return;

    const scriptPath = resolve(config.cwd || process.cwd(), config.script);
    const watchDir = dirname(scriptPath);

    // Default ignore patterns
    const defaultIgnore = [
      '**/node_modules/**',
      '**/.git/**',
      '**/logs/**',
      '**/*.log',
      '**/.turboprocess/**',
    ];

    const ignorePatterns = [
      ...defaultIgnore,
      ...(config.watchIgnore || []),
    ];

    // Create watcher
    const watcher = chokidar.watch(watchDir, {
      ignored: ignorePatterns,
      persistent: true,
      ignoreInitial: true,
    });

    // Create debounced restart function
    const debouncedRestart = debounce(() => {
      this.emit('change', {
        processId,
        filePath: scriptPath,
        changeType: 'change',
      } as ChangeEvent);
    }, WATCH_DEBOUNCE_DELAY);

    this.debouncedRestarts.set(processId, debouncedRestart);

    // Listen for changes
    watcher.on('change', (path) => {
      console.log(`File changed: ${path}, restarting ${config.name}...`);
      debouncedRestart();
    });

    watcher.on('add', (path) => {
      console.log(`File added: ${path}, restarting ${config.name}...`);
      debouncedRestart();
    });

    watcher.on('unlink', (path) => {
      console.log(`File removed: ${path}, restarting ${config.name}...`);
      debouncedRestart();
    });

    this.watchers.set(processId, watcher);
  }

  /**
   * Stop watching files for a process
   */
  async unwatchProcess(processId: string): Promise<void> {
    const watcher = this.watchers.get(processId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(processId);
    }
    this.debouncedRestarts.delete(processId);
  }

  /**
   * Check if process is being watched
   */
  isWatching(processId: string): boolean {
    return this.watchers.has(processId);
  }
}
