import { ProcessInfo } from '../types';
import { nanoid } from 'nanoid';

/**
 * ProcessRegistry manages the in-memory storage of all managed processes
 */
export class ProcessRegistry {
  private processes: Map<string, ProcessInfo>;

  constructor() {
    this.processes = new Map();
  }

  /**
   * Generate a unique process ID
   */
  generateId(): string {
    return nanoid(10);
  }

  /**
   * Add a process to the registry
   */
  add(info: ProcessInfo): void {
    this.processes.set(info.id, info);
  }

  /**
   * Remove a process from the registry
   */
  remove(id: string): void {
    this.processes.delete(id);
  }

  /**
   * Get a process by ID
   */
  get(id: string): ProcessInfo | undefined {
    return this.processes.get(id);
  }

  /**
   * Get a process by name
   */
  getByName(name: string): ProcessInfo | undefined {
    for (const process of this.processes.values()) {
      if (process.name === name) {
        return process;
      }
    }
    return undefined;
  }

  /**
   * Get all processes
   */
  getAll(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * Check if a process exists
   */
  has(id: string): boolean {
    return this.processes.has(id);
  }

  /**
   * Get the number of processes
   */
  size(): number {
    return this.processes.size;
  }

  /**
   * Clear all processes
   */
  clear(): void {
    this.processes.clear();
  }
}
