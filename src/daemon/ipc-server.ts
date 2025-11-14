/**
 * IPC Server for daemon process
 * Handles communication between CLI and daemon via Unix socket
 */

import { Server, Socket, createServer } from 'net';
import { unlink } from 'fs/promises';
import { CLICommand, CLIResponse } from '../types';
import { DAEMON_SOCKET_PATH } from '../utils/constants';
import { fileExists } from '../utils/helpers';

export class IPCServer {
  private server: Server | null = null;
  private commandHandler: ((command: CLICommand) => Promise<CLIResponse>) | null = null;

  /**
   * Start the IPC server
   */
  async start(handler: (command: CLICommand) => Promise<CLIResponse>): Promise<void> {
    this.commandHandler = handler;

    // Remove existing socket file if it exists
    if (await fileExists(DAEMON_SOCKET_PATH)) {
      await unlink(DAEMON_SOCKET_PATH);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(DAEMON_SOCKET_PATH, () => {
        console.log(`IPC server listening on ${DAEMON_SOCKET_PATH}`);
        resolve();
      });
    });
  }

  /**
   * Stop the IPC server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(async (error) => {
        if (error) {
          reject(error);
          return;
        }

        // Clean up socket file
        try {
          if (await fileExists(DAEMON_SOCKET_PATH)) {
            await unlink(DAEMON_SOCKET_PATH);
          }
        } catch (err) {
          // Ignore cleanup errors
        }

        resolve();
      });
    });
  }

  /**
   * Handle incoming client connection
   */
  private handleConnection(socket: Socket): void {
    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      // Check if we have a complete message (ends with newline)
      if (buffer.includes('\n')) {
        const messages = buffer.split('\n');
        buffer = messages.pop() || ''; // Keep incomplete message in buffer

        for (const message of messages) {
          if (message.trim()) {
            await this.handleMessage(socket, message);
          }
        }
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    socket.on('end', () => {
      // Connection closed
    });
  }

  /**
   * Handle a single message from client
   */
  private async handleMessage(socket: Socket, message: string): Promise<void> {
    try {
      const command: CLICommand = JSON.parse(message);

      if (!this.commandHandler) {
        const response: CLIResponse = {
          success: false,
          message: 'Command handler not initialized',
        };
        socket.write(JSON.stringify(response) + '\n');
        return;
      }

      const response = await this.commandHandler(command);
      socket.write(JSON.stringify(response) + '\n');
    } catch (error: any) {
      const response: CLIResponse = {
        success: false,
        message: `Error processing command: ${error.message}`,
      };
      socket.write(JSON.stringify(response) + '\n');
    }
  }
}
