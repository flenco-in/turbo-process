/**
 * IPC Client for CLI
 * Communicates with daemon via Unix socket
 */

import { Socket, connect } from 'net';
import { spawn } from 'child_process';
import { CLICommand, CLIResponse } from '../types';
import { DAEMON_SOCKET_PATH, IPC_RETRY_ATTEMPTS, IPC_RETRY_DELAY } from '../utils/constants';
import { sleep, fileExists } from '../utils/helpers';
import { resolve } from 'path';

export class IPCClient {
  /**
   * Send a command to the daemon and wait for response
   */
  async sendCommand(command: CLICommand): Promise<CLIResponse> {
    // Try to connect with retries
    for (let attempt = 0; attempt < IPC_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.attemptSendCommand(command);
      } catch (error: any) {
        // If daemon not running, try to start it
        if (attempt === 0 && error.code === 'ENOENT') {
          console.log('Daemon not running, starting...');
          await this.startDaemon();
          await sleep(2000); // Wait for daemon to initialize
          continue;
        }

        // Retry with exponential backoff
        if (attempt < IPC_RETRY_ATTEMPTS - 1) {
          await sleep(IPC_RETRY_DELAY * Math.pow(2, attempt));
          continue;
        }

        // Final attempt failed
        throw new Error(`Failed to connect to daemon: ${error.message}`);
      }
    }

    throw new Error('Failed to connect to daemon after retries');
  }

  /**
   * Attempt to send command once
   */
  private attemptSendCommand(command: CLICommand): Promise<CLIResponse> {
    return new Promise((resolve, reject) => {
      const socket = connect(DAEMON_SOCKET_PATH);
      let buffer = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          reject(new Error('Request timeout'));
        }
      }, 10000); // 10 second timeout

      socket.on('connect', () => {
        // Send command
        socket.write(JSON.stringify(command) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();

        // Check if we have a complete response (ends with newline)
        if (buffer.includes('\n')) {
          const lines = buffer.split('\n');
          const responseLine = lines[0];

          if (responseLine.trim()) {
            try {
              const response: CLIResponse = JSON.parse(responseLine);
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                socket.end();
                resolve(response);
              }
            } catch (error: any) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                socket.destroy();
                reject(new Error(`Invalid response from daemon: ${error.message}`));
              }
            }
          }
        }
      });

      socket.on('error', (error: any) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(error);
        }
      });

      socket.on('end', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error('Connection closed by daemon'));
        }
      });
    });
  }

  /**
   * Start the daemon process
   */
  private async startDaemon(): Promise<void> {
    // Get the path to the daemon script
    const daemonPath = resolve(__dirname, '../daemon/index.js');

    // Check if daemon script exists
    if (!(await fileExists(daemonPath))) {
      throw new Error(`Daemon script not found at ${daemonPath}`);
    }

    // Spawn daemon as detached process
    const daemon = spawn('node', [daemonPath], {
      detached: true,
      stdio: 'ignore',
    });

    // Unref so parent can exit
    daemon.unref();

    console.log('Daemon started with PID:', daemon.pid);
  }

  /**
   * Check if daemon is running
   */
  async isDaemonRunning(): Promise<boolean> {
    try {
      const response = await this.attemptSendCommand({
        action: 'ping',
      });
      return response.success;
    } catch {
      return false;
    }
  }
}
