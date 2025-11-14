/**
 * Startup Manager - Auto-start on system reboot
 * KILLER FEATURE: PM2 loses processes on reboot, we don't!
 */

import { writeFile, readFile, chmod } from 'fs/promises';
import { homedir, platform } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { fileExists } from './helpers';

export class StartupManager {
  /**
   * Setup auto-start on system boot
   */
  static async setupStartup(): Promise<string> {
    const os = platform();

    if (os === 'darwin') {
      return await this.setupMacOS();
    } else if (os === 'linux') {
      return await this.setupLinux();
    } else {
      throw new Error(`Startup not supported on ${os}. Supported: macOS, Linux`);
    }
  }

  /**
   * Remove auto-start
   */
  static async removeStartup(): Promise<string> {
    const os = platform();

    if (os === 'darwin') {
      return await this.removeMacOS();
    } else if (os === 'linux') {
      return await this.removeLinux();
    } else {
      throw new Error(`Startup not supported on ${os}`);
    }
  }

  /**
   * Setup for macOS (launchd)
   */
  private static async setupMacOS(): Promise<string> {
    const plistPath = join(homedir(), 'Library/LaunchAgents/com.turboprocess.daemon.plist');
    const daemonPath = join(process.cwd(), 'dist/daemon/index.js');

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.turboprocess.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${daemonPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${homedir()}/.turboprocess/startup.log</string>
    <key>StandardErrorPath</key>
    <string>${homedir()}/.turboprocess/startup-error.log</string>
</dict>
</plist>`;

    await writeFile(plistPath, plistContent, 'utf-8');

    // Load the service
    try {
      execSync(`launchctl load ${plistPath}`);
    } catch (error) {
      // Ignore if already loaded
    }

    return `Startup enabled! Daemon will auto-start on system boot.\nService file: ${plistPath}`;
  }

  /**
   * Remove macOS startup
   */
  private static async removeMacOS(): Promise<string> {
    const plistPath = join(homedir(), 'Library/LaunchAgents/com.turboprocess.daemon.plist');

    try {
      execSync(`launchctl unload ${plistPath}`);
    } catch (error) {
      // Ignore if not loaded
    }

    if (await fileExists(plistPath)) {
      const { unlink } = await import('fs/promises');
      await unlink(plistPath);
    }

    return 'Startup disabled!';
  }

  /**
   * Setup for Linux (systemd)
   */
  private static async setupLinux(): Promise<string> {
    const servicePath = join(homedir(), '.config/systemd/user/turboprocess.service');
    const daemonPath = join(process.cwd(), 'dist/daemon/index.js');

    const serviceContent = `[Unit]
Description=TurboProcess Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node ${daemonPath}
Restart=always
RestartSec=10
StandardOutput=append:${homedir()}/.turboprocess/startup.log
StandardError=append:${homedir()}/.turboprocess/startup-error.log

[Install]
WantedBy=default.target`;

    // Ensure directory exists
    const { mkdir } = await import('fs/promises');
    await mkdir(join(homedir(), '.config/systemd/user'), { recursive: true });

    await writeFile(servicePath, serviceContent, 'utf-8');

    // Enable and start the service
    try {
      execSync('systemctl --user daemon-reload');
      execSync('systemctl --user enable turboprocess.service');
      execSync('systemctl --user start turboprocess.service');
    } catch (error: any) {
      return `Service file created at ${servicePath}\nPlease run manually:\n  systemctl --user enable turboprocess.service\n  systemctl --user start turboprocess.service`;
    }

    return `Startup enabled! Daemon will auto-start on system boot.\nService file: ${servicePath}`;
  }

  /**
   * Remove Linux startup
   */
  private static async removeLinux(): Promise<string> {
    const servicePath = join(homedir(), '.config/systemd/user/turboprocess.service');

    try {
      execSync('systemctl --user stop turboprocess.service');
      execSync('systemctl --user disable turboprocess.service');
    } catch (error) {
      // Ignore if not running
    }

    if (await fileExists(servicePath)) {
      const { unlink } = await import('fs/promises');
      await unlink(servicePath);
    }

    return 'Startup disabled!';
  }

  /**
   * Check if startup is enabled
   */
  static async isStartupEnabled(): Promise<boolean> {
    const os = platform();

    if (os === 'darwin') {
      const plistPath = join(homedir(), 'Library/LaunchAgents/com.turboprocess.daemon.plist');
      return await fileExists(plistPath);
    } else if (os === 'linux') {
      const servicePath = join(homedir(), '.config/systemd/user/turboprocess.service');
      return await fileExists(servicePath);
    }

    return false;
  }
}
