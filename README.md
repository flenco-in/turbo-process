<div align="center">

[![Flenco Logo](https://flenco.in/wp-content/uploads/2023/09/cropped-flenco-2023.png)](https://flenco.in)

# TurboProcess

### A Modern Process Manager for Node.js Applications

[![npm version](https://img.shields.io/npm/v/turboprocess.svg)](https://www.npmjs.com/package/turboprocess)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D14.0.0-green.svg)](https://nodejs.org/)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-atishpaul-orange.svg)](https://www.buymeacoffee.com/atishpaul)

[Features](#features) • [Installation](#installation) • [Quick Start](#quick-start) • [Documentation](#documentation) • [Contributing](#contributing)

</div>

---

## Overview

TurboProcess is a lightweight, reliable process manager designed for Node.js applications. It provides intelligent process management with automatic restart capabilities, resource monitoring, and comprehensive logging - all while maintaining a minimal footprint.

## Features

### 🔄 Intelligent Process Management
- **Smart Auto-Restart**: Exponential backoff strategy prevents restart loops
- **Crash Detection**: Automatically detects and prevents crash loops (5 crashes in 60 seconds)
- **Graceful Shutdown**: Proper SIGTERM/SIGKILL handling with configurable timeouts
- **Process Persistence**: Automatically restores processes after system reboots

### 📊 Resource Monitoring
- **Real-time Metrics**: CPU and memory usage tracked every 5 seconds
- **Threshold Alerts**: Configurable memory and CPU limits with automatic restart
- **Rolling Averages**: Smooth CPU metrics using rolling window calculations
- **Early Warnings**: Get notified at 80% of memory limit

### 📝 Advanced Logging
- **Automatic Rotation**: Logs rotate at 10MB with 5 file retention
- **Multiple Formats**: Support for plain text and JSON logging
- **Flexible Output**: Write to files or stdout for container environments
- **Log Streaming**: View real-time logs with configurable line limits

### 🔍 Crash Analytics
- **Detailed Reports**: Every crash recorded with full context (CPU, memory, uptime, exit code)
- **Historical Data**: Maintains last 100 crashes per process
- **Pattern Detection**: Identifies crash patterns and common failure modes
- **Timeline View**: Visualize crash history with timestamps

### 👀 Development Features
- **Watch Mode**: Automatically restart on file changes with smart debouncing
- **Health Checks**: HTTP endpoint verification with retry logic
- **Hot Reload**: Quick restarts during development

### ⚙️ Configuration
- **YAML Support**: Clean, readable configuration files
- **Validation**: Comprehensive config validation with helpful error messages
- **Environment Variables**: Easy environment configuration per process
- **Multiple Processes**: Manage multiple applications from a single config file

### 🎨 Beautiful CLI
- **Color-Coded Status**: Visual indicators for process health
- **Formatted Tables**: Clean, readable status output
- **Human-Readable**: Uptime and memory displayed in friendly formats
- **Quick Commands**: Simple, intuitive command structure

### 🚀 System Integration
- **Auto-Start on Boot**: Daemon automatically starts on system reboot (macOS & Linux)
- **State Persistence**: Process configurations survive system restarts
- **Background Daemon**: Lightweight daemon manages all processes
- **IPC Communication**: Fast Unix socket communication

## Installation

```bash
npm install -g turboprocess
```

## Quick Start

### Start a Process

```bash
# Start a simple process
turbo start app.js

# Start with a custom name
turbo start app.js --name my-api

# Start with watch mode for development
turbo start app.js --name dev-server --watch

# Start with environment variables
turbo start app.js --name api --env NODE_ENV=production PORT=3000
```

### View Process Status

```bash
turbo status
```

Output:
```
┌────────────┬────────┬───────────┬───┬──────┬────────┬────────┐
│ ID         │ Name   │ Status    │ ↻ │ CPU  │ Memory │ Uptime │
├────────────┼────────┼───────────┼───┼──────┼────────┼────────┤
│ abc123xyz  │ my-api │ ● running │ 0 │ 2.5% │ 45 MB  │ 2h 15m │
└────────────┴────────┴───────────┴───┴──────┴────────┴────────┘
```

### Manage Processes

```bash
# View logs
turbo logs my-api

# Restart a process
turbo restart my-api

# Stop a process
turbo stop my-api

# Stop all processes
turbo stop all

# Remove a process from registry
turbo delete my-api
```

### Enable Auto-Start on System Boot

```bash
# Enable daemon to start on system boot
turbo startup

# Disable auto-start
turbo unstartup
```

This ensures your processes automatically restart even after server reboots or updates!

## Configuration

### Using a Configuration File

Create a `turbo.yml` file:

```yaml
apps:
  - name: api-server
    script: ./dist/server.js
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

  - name: background-worker
    script: ./dist/worker.js
    env:
      NODE_ENV: production
    memory_limit: 256mb
    restart_delay: 1000
```

Start all processes from config:

```bash
turbo start turbo.yml
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | required | Process name (must be unique) |
| `script` | string | required | Path to your Node.js script |
| `args` | array | - | Command line arguments |
| `cwd` | string | - | Working directory |
| `env` | object | - | Environment variables |
| `instances` | number | 1 | Number of instances to run |
| `watch` | boolean | false | Enable watch mode |
| `watch_ignore` | array | - | Patterns to ignore in watch mode |
| `memory_limit` | string | - | Memory limit (e.g., "512mb", "1gb") |
| `cpu_limit` | number | - | CPU limit percentage (0-100) |
| `restart_delay` | number | 1000 | Delay between restarts (ms) |
| `max_restarts` | number | 10 | Maximum restart attempts |
| `health_check` | string | - | Health check URL |
| `log_format` | string | "text" | Log format: "text" or "json" |
| `log_output` | string | "file" | Log output: "file" or "stdout" |

## Documentation

### Commands

#### `turbo start <script|config>`

Start a process from a script file or configuration file.

**Options:**
- `-n, --name <name>` - Process name
- `-i, --instances <number>` - Number of instances
- `-w, --watch` - Enable watch mode
- `--env <vars...>` - Environment variables (KEY=VALUE format)

**Examples:**
```bash
turbo start app.js --name api
turbo start app.js --name dev --watch
turbo start turbo.yml
```

#### `turbo stop <target>`

Stop a process by ID, name, or all processes.

**Examples:**
```bash
turbo stop api
turbo stop abc123xyz
turbo stop all
```

#### `turbo restart <target>`

Restart a process by ID, name, or all processes.

**Examples:**
```bash
turbo restart api
turbo restart all
```

#### `turbo status`

Display status of all managed processes in a formatted table.

#### `turbo logs <target>`

Stream logs from a process.

**Options:**
- `-n, --lines <number>` - Number of lines to show (default: 100)
- `-f, --follow` - Follow log output (coming soon)

**Examples:**
```bash
turbo logs api
turbo logs api --lines 50
```

#### `turbo save`

Manually save current process state.

#### `turbo delete <target>`

Remove a process from the registry.

#### `turbo startup`

Enable TurboProcess daemon to auto-start on system boot. This ensures your processes are automatically restored after server reboots.

**Supported Platforms:**
- macOS (using launchd)
- Linux (using systemd)

#### `turbo unstartup`

Disable auto-start on system boot.

## How It Works

### Architecture

TurboProcess uses a daemon-based architecture:

1. **CLI**: Lightweight client that sends commands to the daemon
2. **Daemon**: Background process that manages all applications
3. **IPC**: Fast Unix socket communication between CLI and daemon
4. **Components**: Modular design with specialized managers for logging, monitoring, crashes, etc.

### Process Lifecycle

1. **Start**: Process is spawned and registered
2. **Monitor**: CPU, memory, and logs are continuously tracked
3. **Crash**: If process exits unexpectedly, crash is recorded
4. **Restart**: Process restarts with exponential backoff
5. **Persist**: State is saved for recovery after system restarts

### Auto-Restart Logic

When a process crashes:
1. Crash is recorded with full context
2. Restart delay is calculated using exponential backoff
3. Process restarts after delay
4. If 5 crashes occur within 60 seconds, restart attempts stop
5. If max restarts reached, process is marked as failed

### Resource Monitoring

Every 5 seconds:
1. CPU and memory usage is measured
2. Metrics are compared against configured limits
3. If memory exceeds limit for 3 consecutive checks, process restarts
4. If CPU exceeds limit for 5 consecutive checks, process restarts
5. Warning is logged at 80% of memory limit

## File Locations

TurboProcess stores data in `~/.turboprocess/`:

```
~/.turboprocess/
├── daemon.pid          # Daemon process ID
├── daemon.log          # Daemon logs
├── state.json          # Process state (for persistence)
├── logs/               # Process logs
│   └── <process-id>/
│       ├── app.log
│       ├── app.log.1
│       └── ...
└── crashes/            # Crash reports
    └── <process-id>.json
```

## Performance

- **CLI Latency**: < 100ms
- **Memory per Process**: ~40MB
- **Package Size**: ~3MB
- **Dependencies**: 7 production dependencies
- **Startup Time**: < 500ms

## Requirements

- Node.js >= 14.0.0
- macOS or Linux (for auto-start feature)

## Development

```bash
# Clone repository
git clone https://github.com/flenco-in/turbo-process.git
cd turbo-process

# Install dependencies
npm install

# Build
npm run build

# Link for local testing
npm link

# Test
turbo start app.js
turbo status
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Daemon won't start

```bash
# Check if daemon is running
ps aux | grep turboprocess

# Remove stale files
rm -f ~/.turboprocess/daemon.pid /tmp/turboprocess.sock

# Try starting again
turbo status
```

### Process keeps crashing

```bash
# Check crash reports
cat ~/.turboprocess/crashes/<process-id>.json

# View logs
turbo logs <process-name>

# Check if in crash loop (5 crashes in 60s)
turbo status
```

### Logs not appearing

Logs are stored in `~/.turboprocess/logs/<process-id>/app.log`

```bash
# Find your process ID
turbo status

# View log file directly
cat ~/.turboprocess/logs/<process-id>/app.log
```

## License

MIT © [Flenco.in](https://flenco.in)

## Support

- 🐛 [Report Issues](https://github.com/flenco-in/turbo-process/issues)
- 💬 [Discussions](https://github.com/flenco-in/turbo-process/discussions)
- ☕ [Buy Me A Coffee](https://www.buymeacoffee.com/atishpaul)

---

<div align="center">

**Built with ❤️ by [Flenco.in](https://flenco.in)**

</div>
