/**
 * Configuration file parser and validator
 */

import { parse as parseYaml } from 'yaml';
import { readFile } from 'fs/promises';
import { ProcessConfig } from '../types';
import { parseMemoryLimit, fileExists } from './helpers';
import { resolve } from 'path';

interface ConfigFile {
  apps: ProcessConfig[];
}

interface ValidationError {
  field: string;
  message: string;
  line?: number;
}

export class ConfigParser {
  /**
   * Parse and validate a YAML config file
   */
  async parseConfigFile(filePath: string): Promise<ProcessConfig[]> {
    // Check if file exists
    if (!(await fileExists(filePath))) {
      throw new Error(`Config file not found: ${filePath}`);
    }

    // Read file content
    const content = await readFile(filePath, 'utf-8');

    // Parse YAML
    let config: ConfigFile;
    try {
      config = parseYaml(content) as ConfigFile;
    } catch (error: any) {
      throw new Error(`Invalid YAML syntax: ${error.message}`);
    }

    // Validate structure
    if (!config || typeof config !== 'object') {
      throw new Error('Config file must be a valid YAML object');
    }

    if (!config.apps || !Array.isArray(config.apps)) {
      throw new Error('Config file must contain an "apps" array');
    }

    if (config.apps.length === 0) {
      throw new Error('Config file must contain at least one app');
    }

    // Validate and normalize each app config
    const processConfigs: ProcessConfig[] = [];
    const names = new Set<string>();

    for (let i = 0; i < config.apps.length; i++) {
      const app = config.apps[i];
      const errors = this.validateAppConfig(app, i);

      if (errors.length > 0) {
        const errorMessages = errors.map(e => 
          `  - ${e.field}: ${e.message}${e.line ? ` (line ${e.line})` : ''}`
        ).join('\n');
        throw new Error(`Validation errors in app ${i + 1}:\n${errorMessages}`);
      }

      // Check for duplicate names
      if (names.has(app.name)) {
        throw new Error(`Duplicate app name: ${app.name}`);
      }
      names.add(app.name);

      // Normalize config
      const normalized = this.normalizeConfig(app);
      processConfigs.push(normalized);
    }

    return processConfigs;
  }

  /**
   * Validate a single app configuration
   */
  private validateAppConfig(app: any, index: number): ValidationError[] {
    const errors: ValidationError[] = [];

    // Required fields
    if (!app.name || typeof app.name !== 'string') {
      errors.push({
        field: 'name',
        message: 'Required field, must be a string',
      });
    }

    if (!app.script || typeof app.script !== 'string') {
      errors.push({
        field: 'script',
        message: 'Required field, must be a string',
      });
    }

    // Optional fields validation
    if (app.instances !== undefined) {
      if (app.instances !== 'auto' && 
          (typeof app.instances !== 'number' || app.instances < 1)) {
        errors.push({
          field: 'instances',
          message: 'Must be a positive number or "auto"',
        });
      }
    }

    if (app.env !== undefined && typeof app.env !== 'object') {
      errors.push({
        field: 'env',
        message: 'Must be an object',
      });
    }

    if (app.watch !== undefined && typeof app.watch !== 'boolean') {
      errors.push({
        field: 'watch',
        message: 'Must be a boolean',
      });
    }

    if (app.memory_limit !== undefined) {
      if (typeof app.memory_limit !== 'string') {
        errors.push({
          field: 'memory_limit',
          message: 'Must be a string (e.g., "512mb", "1gb")',
        });
      } else {
        try {
          parseMemoryLimit(app.memory_limit);
        } catch (error: any) {
          errors.push({
            field: 'memory_limit',
            message: error.message,
          });
        }
      }
    }

    if (app.cpu_limit !== undefined) {
      if (typeof app.cpu_limit !== 'number' || 
          app.cpu_limit < 0 || 
          app.cpu_limit > 100) {
        errors.push({
          field: 'cpu_limit',
          message: 'Must be a number between 0 and 100',
        });
      }
    }

    if (app.restart_delay !== undefined) {
      if (typeof app.restart_delay !== 'number' || app.restart_delay < 0) {
        errors.push({
          field: 'restart_delay',
          message: 'Must be a positive number',
        });
      }
    }

    if (app.max_restarts !== undefined) {
      if (typeof app.max_restarts !== 'number' || app.max_restarts < 0) {
        errors.push({
          field: 'max_restarts',
          message: 'Must be a positive number',
        });
      }
    }

    if (app.health_check !== undefined) {
      if (typeof app.health_check !== 'string') {
        errors.push({
          field: 'health_check',
          message: 'Must be a URL string',
        });
      } else {
        try {
          new URL(app.health_check);
        } catch {
          errors.push({
            field: 'health_check',
            message: 'Must be a valid URL',
          });
        }
      }
    }

    if (app.log_format !== undefined) {
      if (app.log_format !== 'text' && app.log_format !== 'json') {
        errors.push({
          field: 'log_format',
          message: 'Must be "text" or "json"',
        });
      }
    }

    if (app.log_output !== undefined) {
      if (app.log_output !== 'file' && app.log_output !== 'stdout') {
        errors.push({
          field: 'log_output',
          message: 'Must be "file" or "stdout"',
        });
      }
    }

    if (app.metrics_port !== undefined) {
      if (typeof app.metrics_port !== 'number' || 
          app.metrics_port < 1 || 
          app.metrics_port > 65535) {
        errors.push({
          field: 'metrics_port',
          message: 'Must be a number between 1 and 65535',
        });
      }
    }

    if (app.args !== undefined && !Array.isArray(app.args)) {
      errors.push({
        field: 'args',
        message: 'Must be an array',
      });
    }

    if (app.cwd !== undefined && typeof app.cwd !== 'string') {
      errors.push({
        field: 'cwd',
        message: 'Must be a string',
      });
    }

    if (app.watch_ignore !== undefined && !Array.isArray(app.watch_ignore)) {
      errors.push({
        field: 'watch_ignore',
        message: 'Must be an array',
      });
    }

    return errors;
  }

  /**
   * Normalize configuration (convert snake_case to camelCase, etc.)
   */
  private normalizeConfig(app: any): ProcessConfig {
    const config: ProcessConfig = {
      name: app.name,
      script: app.script,
    };

    // Optional fields
    if (app.args !== undefined) config.args = app.args;
    if (app.cwd !== undefined) config.cwd = app.cwd;
    if (app.env !== undefined) config.env = app.env;
    if (app.instances !== undefined) config.instances = app.instances;
    if (app.watch !== undefined) config.watch = app.watch;
    if (app.watch_ignore !== undefined) config.watchIgnore = app.watch_ignore;
    if (app.memory_limit !== undefined) config.memoryLimit = app.memory_limit;
    if (app.cpu_limit !== undefined) config.cpuLimit = app.cpu_limit;
    if (app.restart_delay !== undefined) config.restartDelay = app.restart_delay;
    if (app.max_restarts !== undefined) config.maxRestarts = app.max_restarts;
    if (app.health_check !== undefined) config.healthCheck = app.health_check;
    if (app.log_format !== undefined) config.logFormat = app.log_format;
    if (app.log_output !== undefined) config.logOutput = app.log_output;
    if (app.metrics_port !== undefined) config.metricsPort = app.metrics_port;

    return config;
  }

  /**
   * Generate a sample config file
   */
  static generateSampleConfig(): string {
    return `# TurboProcess Configuration File
apps:
  - name: api-server
    script: ./dist/server.js
    instances: auto
    env:
      NODE_ENV: production
      PORT: 3000
    watch: false
    memory_limit: 512mb
    cpu_limit: 80
    restart_delay: 2000
    max_restarts: 10
    health_check: http://localhost:3000/health
    log_format: json
    log_output: file
    metrics_port: 9090

  - name: worker
    script: ./dist/worker.js
    instances: 2
    env:
      NODE_ENV: production
    watch: false
    memory_limit: 256mb
`;
  }
}
