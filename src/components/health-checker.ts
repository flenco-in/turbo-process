/**
 * Health Checker - HTTP health check support
 */

import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { HealthCheckResult } from '../types';
import { HEALTH_CHECK_TIMEOUT, HEALTH_CHECK_RETRY_DELAY, HEALTH_CHECK_MAX_RETRIES } from '../utils/constants';
import { sleep } from '../utils/helpers';

export class HealthChecker {
  /**
   * Check health of a process via HTTP endpoint
   */
  async checkHealth(processId: string, url: string): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const requestFn = isHttps ? httpsRequest : httpRequest;

      return await new Promise<HealthCheckResult>((resolve) => {
        const req = requestFn(
          {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            timeout: HEALTH_CHECK_TIMEOUT,
          },
          (res) => {
            const responseTime = Date.now() - startTime;
            const healthy = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;

            resolve({
              healthy,
              statusCode: res.statusCode,
              responseTime,
            });

            // Drain response
            res.resume();
          }
        );

        req.on('error', (error) => {
          resolve({
            healthy: false,
            responseTime: Date.now() - startTime,
            error: error.message,
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            healthy: false,
            responseTime: Date.now() - startTime,
            error: 'Request timeout',
          });
        });

        req.end();
      });
    } catch (error: any) {
      return {
        healthy: false,
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Wait for process to become healthy
   */
  async waitForHealthy(
    processId: string,
    url: string,
    timeout: number
  ): Promise<boolean> {
    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < timeout) {
      attempts++;

      const result = await this.checkHealth(processId, url);

      if (result.healthy) {
        console.log(`Health check passed for ${processId} after ${attempts} attempt(s)`);
        return true;
      }

      if (attempts >= HEALTH_CHECK_MAX_RETRIES) {
        console.log(`Health check failed for ${processId} after ${attempts} attempts`);
        return false;
      }

      // Wait before retry
      await sleep(HEALTH_CHECK_RETRY_DELAY);
    }

    console.log(`Health check timeout for ${processId}`);
    return false;
  }

  /**
   * Check health with retries
   */
  async checkHealthWithRetries(processId: string, url: string): Promise<HealthCheckResult> {
    let lastResult: HealthCheckResult = {
      healthy: false,
      responseTime: 0,
      error: 'No attempts made',
    };

    for (let i = 0; i < HEALTH_CHECK_MAX_RETRIES; i++) {
      lastResult = await this.checkHealth(processId, url);

      if (lastResult.healthy) {
        return lastResult;
      }

      if (i < HEALTH_CHECK_MAX_RETRIES - 1) {
        await sleep(HEALTH_CHECK_RETRY_DELAY);
      }
    }

    return lastResult;
  }
}
