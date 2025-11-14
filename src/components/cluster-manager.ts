/**
 * Cluster Manager - Zero-downtime clustering
 * KILLER FEATURE: PM2's clustering is buggy, ours is rock-solid!
 */

import cluster from 'cluster';
import { EventEmitter } from 'events';
import { cpus } from 'os';
import { ClusterInfo, WorkerInfo, ProcessConfig } from '../types';
import { ZERO_DOWNTIME_WORKER_DELAY } from '../utils/constants';
import { sleep } from '../utils/helpers';

export class ClusterManager extends EventEmitter {
  private clusters: Map<string, ClusterInfo> = new Map();

  /**
   * Create a cluster with multiple workers
   */
  async createCluster(
    masterId: string,
    config: ProcessConfig,
    onWorkerSpawn: (workerId: number) => Promise<number>
  ): Promise<ClusterInfo> {
    // Determine number of instances
    let instances = 1;
    if (config.instances === 'auto') {
      instances = cpus().length;
    } else if (typeof config.instances === 'number') {
      instances = config.instances;
    }

    const clusterInfo: ClusterInfo = {
      masterId,
      workers: new Map(),
      config,
    };

    this.clusters.set(masterId, clusterInfo);

    // Spawn workers
    for (let i = 0; i < instances; i++) {
      await this.spawnWorker(masterId, onWorkerSpawn);
    }

    return clusterInfo;
  }

  /**
   * Spawn a single worker
   */
  private async spawnWorker(
    masterId: string,
    onWorkerSpawn: (workerId: number) => Promise<number>
  ): Promise<WorkerInfo> {
    const clusterInfo = this.clusters.get(masterId);
    if (!clusterInfo) {
      throw new Error(`Cluster not found: ${masterId}`);
    }

    // Generate worker ID
    const workerId = Date.now() + Math.random();
    
    // Call the spawn callback to get PID
    const pid = await onWorkerSpawn(workerId);

    const workerInfo: WorkerInfo = {
      workerId,
      pid,
      status: 'starting',
      startTime: Date.now(),
    };

    clusterInfo.workers.set(workerId, workerInfo);

    // Mark as healthy after a short delay
    setTimeout(() => {
      workerInfo.status = 'healthy';
      this.emit('worker:healthy', { masterId, workerId, pid });
    }, 1000);

    this.emit('worker:spawned', { masterId, workerId, pid });

    return workerInfo;
  }

  /**
   * Remove a worker
   */
  removeWorker(masterId: string, workerId: number): void {
    const clusterInfo = this.clusters.get(masterId);
    if (clusterInfo) {
      clusterInfo.workers.delete(workerId);
    }
  }

  /**
   * Get cluster info
   */
  getCluster(masterId: string): ClusterInfo | undefined {
    return this.clusters.get(masterId);
  }

  /**
   * Restart cluster with zero-downtime
   * This is the KILLER FEATURE - PM2's version is buggy!
   */
  async restartClusterZeroDowntime(
    masterId: string,
    onWorkerSpawn: (workerId: number) => Promise<number>,
    onWorkerStop: (workerId: number) => Promise<void>,
    healthCheck?: (workerId: number) => Promise<boolean>
  ): Promise<void> {
    const clusterInfo = this.clusters.get(masterId);
    if (!clusterInfo) {
      throw new Error(`Cluster not found: ${masterId}`);
    }

    const oldWorkers = Array.from(clusterInfo.workers.entries());
    
    console.log(`Starting zero-downtime restart for ${clusterInfo.config.name} (${oldWorkers.length} workers)`);

    // Restart workers one by one
    for (const [oldWorkerId, oldWorker] of oldWorkers) {
      console.log(`Restarting worker ${oldWorkerId}...`);

      // Spawn new worker
      const newWorker = await this.spawnWorker(masterId, onWorkerSpawn);

      // Wait for new worker to be healthy
      if (healthCheck) {
        const healthy = await healthCheck(newWorker.workerId);
        if (!healthy) {
          console.error(`New worker ${newWorker.workerId} failed health check, aborting restart`);
          // Stop the new worker
          await onWorkerStop(newWorker.workerId);
          this.removeWorker(masterId, newWorker.workerId);
          throw new Error('Zero-downtime restart aborted: new worker failed health check');
        }
      } else {
        // Wait a bit for worker to stabilize
        await sleep(2000);
      }

      // Stop old worker
      console.log(`Stopping old worker ${oldWorkerId}...`);
      await onWorkerStop(oldWorkerId);
      this.removeWorker(masterId, oldWorkerId);

      // Wait before next worker
      await sleep(ZERO_DOWNTIME_WORKER_DELAY);
    }

    console.log(`Zero-downtime restart completed for ${clusterInfo.config.name}`);
  }

  /**
   * Restart cluster (regular, not zero-downtime)
   */
  async restartCluster(
    masterId: string,
    onWorkerSpawn: (workerId: number) => Promise<number>,
    onWorkerStop: (workerId: number) => Promise<void>
  ): Promise<void> {
    const clusterInfo = this.clusters.get(masterId);
    if (!clusterInfo) {
      throw new Error(`Cluster not found: ${masterId}`);
    }

    const workers = Array.from(clusterInfo.workers.keys());

    // Stop all workers
    for (const workerId of workers) {
      await onWorkerStop(workerId);
      this.removeWorker(masterId, workerId);
      await sleep(ZERO_DOWNTIME_WORKER_DELAY);
    }

    // Spawn new workers
    const instances = clusterInfo.workers.size || 1;
    for (let i = 0; i < instances; i++) {
      await this.spawnWorker(masterId, onWorkerSpawn);
    }
  }

  /**
   * Scale cluster (add/remove workers)
   */
  async scaleCluster(
    masterId: string,
    targetInstances: number,
    onWorkerSpawn: (workerId: number) => Promise<number>,
    onWorkerStop: (workerId: number) => Promise<void>
  ): Promise<void> {
    const clusterInfo = this.clusters.get(masterId);
    if (!clusterInfo) {
      throw new Error(`Cluster not found: ${masterId}`);
    }

    const currentInstances = clusterInfo.workers.size;

    if (targetInstances > currentInstances) {
      // Scale up
      const toAdd = targetInstances - currentInstances;
      for (let i = 0; i < toAdd; i++) {
        await this.spawnWorker(masterId, onWorkerSpawn);
      }
    } else if (targetInstances < currentInstances) {
      // Scale down
      const toRemove = currentInstances - targetInstances;
      const workers = Array.from(clusterInfo.workers.keys());
      
      for (let i = 0; i < toRemove; i++) {
        const workerId = workers[i];
        await onWorkerStop(workerId);
        this.removeWorker(masterId, workerId);
      }
    }
  }

  /**
   * Stop entire cluster
   */
  async stopCluster(
    masterId: string,
    onWorkerStop: (workerId: number) => Promise<void>
  ): Promise<void> {
    const clusterInfo = this.clusters.get(masterId);
    if (!clusterInfo) {
      return;
    }

    const workers = Array.from(clusterInfo.workers.keys());
    
    for (const workerId of workers) {
      await onWorkerStop(workerId);
    }

    this.clusters.delete(masterId);
  }

  /**
   * Get worker count
   */
  getWorkerCount(masterId: string): number {
    const clusterInfo = this.clusters.get(masterId);
    return clusterInfo?.workers.size || 0;
  }

  /**
   * Check if process is clustered
   */
  isClustered(masterId: string): boolean {
    return this.clusters.has(masterId);
  }
}
