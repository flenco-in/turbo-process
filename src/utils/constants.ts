import { join } from 'path';
import { homedir } from 'os';

/**
 * Application constants and default values
 */

// Base directory for TurboProcess data
export const TURBO_HOME = join(homedir(), '.turboprocess');

// Daemon configuration
export const DAEMON_PID_FILE = join(TURBO_HOME, 'daemon.pid');
export const DAEMON_LOG_FILE = join(TURBO_HOME, 'daemon.log');
export const DAEMON_SOCKET_PATH = process.platform === 'win32' 
  ? '\\\\.\\pipe\\turboprocess' 
  : '/tmp/turboprocess.sock';

// State persistence
export const STATE_FILE = join(TURBO_HOME, 'state.json');

// Logs directory
export const LOGS_DIR = join(TURBO_HOME, 'logs');

// Crashes directory
export const CRASHES_DIR = join(TURBO_HOME, 'crashes');

// Default restart policy
export const DEFAULT_RESTART_POLICY = {
  maxRestarts: 10,
  restartWindow: 60,
  backoffStrategy: 'exponential' as const,
  minDelay: 1000,
  maxDelay: 30000,
};

// Default process config values
export const DEFAULT_PROCESS_CONFIG = {
  instances: 1,
  watch: false,
  restartDelay: 1000,
  maxRestarts: 10,
  logFormat: 'text' as const,
  logOutput: 'file' as const,
};

// Timeouts and intervals
export const PROCESS_STOP_TIMEOUT = 10000; // 10 seconds
export const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds
export const HEALTH_CHECK_RETRY_DELAY = 2000; // 2 seconds
export const HEALTH_CHECK_MAX_RETRIES = 3;
export const RESOURCE_MONITOR_INTERVAL = 5000; // 5 seconds
export const WATCH_DEBOUNCE_DELAY = 500; // 500ms
export const STATE_SAVE_DEBOUNCE = 1000; // 1 second

// Log rotation
export const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB
export const LOG_MAX_FILES = 5;

// Crash detection
export const CRASH_LOOP_THRESHOLD = 5; // crashes
export const CRASH_LOOP_WINDOW = 60; // seconds
export const MAX_CRASH_RECORDS = 100;

// Memory threshold warning
export const MEMORY_WARNING_THRESHOLD = 0.8; // 80%

// Resource monitoring
export const MEMORY_CHECK_CONSECUTIVE = 3;
export const CPU_CHECK_CONSECUTIVE = 5;
export const CPU_ROLLING_AVERAGE_SAMPLES = 3;
export const RESOURCE_HISTORY_SIZE = 60;

// Zero-downtime restart
export const ZERO_DOWNTIME_HEALTH_TIMEOUT = 30000; // 30 seconds
export const ZERO_DOWNTIME_WORKER_DELAY = 2000; // 2 seconds

// IPC
export const IPC_RETRY_ATTEMPTS = 3;
export const IPC_RETRY_DELAY = 1000; // 1 second

// Version
export const VERSION = '0.1.0';
