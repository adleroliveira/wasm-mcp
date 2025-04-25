import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface InstallerOptions {
  path: string;
}

export class Installer {
  private readonly path: string;

  constructor(options: InstallerOptions) {
    this.path = options.path;
  }

  async initDir(): Promise<void> {
    await fs.mkdir(path.join(process.cwd(), this.path), { recursive: true });
  }

  async install(config: MCPServerConfig, projectName: string): Promise<string> {
    const packageDir = path.join(process.cwd(), this.path, projectName);
    await fs.mkdir(packageDir, { recursive: true });
    await this.installPackage(packageDir, config);
    return packageDir;
  }

  async installPackage(packageDir: string, config: MCPServerConfig): Promise<string> {
    if (config.command !== 'npm' && config.command !== 'npx') {
      throw new Error('Only npm and npx commands are supported');
    }

    // Find the package name by skipping any flags
    const packageName = config.args.find(arg => !arg.startsWith('-'));
    if (!packageName) {
      throw new Error('No package name found in arguments');
    }

    console.log(`Downloading package: ${packageName} to ${packageDir}`);

    // First download the package tarball
    const packProc = spawn('npm', ['pack', packageName], {
      stdio: 'pipe',
      cwd: packageDir
    });

    let tarballName = '';
    packProc.stdout.on('data', (data) => {
      tarballName = data.toString().trim();
      console.log(`Downloaded tarball: ${tarballName}`);
    });

    packProc.stderr.on('data', (data) => {
      console.error(`npm pack stderr: ${data.toString()}`);
    });

    await new Promise((resolve, reject) => {
      packProc.on('close', (code) => {
        if (code === 0) {
          resolve(null);
        } else {
          reject(new Error(`Failed to download package: ${packageName}`));
        }
      });
    });

    // Create a directory for the extracted package
    const sourceDir = path.join(packageDir, 'source');
    await fs.mkdir(sourceDir, { recursive: true });

    // Verify tarball exists
    const tarballPath = path.join(packageDir, tarballName);
    try {
      await fs.access(tarballPath);
      console.log(`Tarball exists at: ${tarballPath}`);
    } catch (error) {
      throw new Error(`Tarball not found at: ${tarballPath}`);
    }

    // Extract the tarball
    const extractProc = spawn('tar', ['-xf', tarballPath, '--strip-components=1'], {
      stdio: 'pipe',
      cwd: sourceDir
    });

    extractProc.stdout.on('data', (data) => {
      console.log(`tar stdout: ${data.toString()}`);
    });

    extractProc.stderr.on('data', (data) => {
      console.error(`tar stderr: ${data.toString()}`);
    });

    await new Promise((resolve, reject) => {
      extractProc.on('close', (code) => {
        if (code === 0) {
          resolve(null);
        } else {
          reject(new Error(`Failed to extract package: ${packageName}. Exit code: ${code}`));
        }
      });
    });

    // Clean up the tarball
    await fs.unlink(tarballPath);
    console.log(`Cleaned up tarball: ${tarballPath}`);

    // Commented out installation for inspection
    /*
    // Install dependencies
    const installProc = spawn('npm', ['install'], {
      stdio: 'pipe',
      cwd: packageDir
    });

    await new Promise((resolve, reject) => {
      installProc.on('close', (code) => {
        if (code === 0) {
          resolve(null);
        } else {
          reject(new Error(`Failed to install dependencies for package: ${packageName}`));
        }
      });
    });
    */

    return packageDir;
  }
}