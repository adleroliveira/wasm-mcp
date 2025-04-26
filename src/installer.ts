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
    // Find the package name by skipping any flags
    const packageName = config.args.find(arg => !arg.startsWith('-'));
    if (!packageName) {
      throw new Error('No package name found in arguments');
    }

    // Try to get GitHub repository URL from npm package
    try {
      const repoUrl = await this.getGitHubRepoFromNpm(packageName);
      if (repoUrl) {
        console.log(`Found GitHub repository: ${repoUrl}`);
        return this.installFromGitHub(packageDir, repoUrl);
      } else {
        console.warn(`Could not find GitHub repository for ${packageName}, falling back to npm pack`);
      }
    } catch (error) {
      console.warn(`Could not find GitHub repository for ${packageName}, falling back to npm pack`);
    }

    // Fall back to npm pack if GitHub repository is not found
    console.log(`Downloading package: ${packageName} to ${packageDir}`);

    // First download the package tarball
    const packProc = spawn('npm', ['pack', packageName], {
      stdio: ['pipe', 'pipe', 'ignore'], // Ignore stderr
      cwd: packageDir
    });

    let tarballName = '';
    packProc.stdout.on('data', (data) => {
      tarballName = data.toString().trim();
      console.log(`Downloaded tarball: ${tarballName}`);
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
      stdio: ['pipe', 'ignore', 'ignore'], // Ignore stdout and stderr
      cwd: sourceDir
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

    // Ensure package.json exists in source directory
    try {
      await fs.access(path.join(sourceDir, 'package.json'));
    } catch {
      // If no package.json exists, create a minimal one
      await fs.writeFile(
        path.join(sourceDir, 'package.json'),
        JSON.stringify({
          name: packageName,
          version: '1.0.0',
          private: true
        }, null, 2)
      );
    }

    // Install dependencies with --no-save to prevent modifying package.json
    console.log(`Installing dependencies in ${sourceDir}`);
    const installProc = spawn('npm', ['install', '--no-save', '--production', '--prefer-offline', '--no-audit', '--no-package-lock'], {
      stdio: 'pipe',
      cwd: sourceDir,
      env: {
        ...process.env,
        // Ensure npm doesn't use the parent project's node_modules
        NODE_PATH: undefined
      }
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

    return packageDir;
  }

  private async getGitHubRepoFromNpm(packageName: string): Promise<string | null> {
    console.log(`Attempting to get repository URL for package: ${packageName}`);

    const viewProc = spawn('npm', ['view', packageName, 'repository.url'], {
      stdio: 'pipe'
    });

    let output = '';
    viewProc.stdout.on('data', (data) => {
      const dataStr = data.toString().trim();
      output += dataStr;
      console.log(`npm view stdout: ${dataStr}`);
    });

    viewProc.stderr.on('data', (data) => {
      console.error(`npm view stderr: ${data.toString()}`);
    });

    try {
      await new Promise((resolve, reject) => {
        viewProc.on('close', (code) => {
          if (code === 0) {
            resolve(null);
          } else {
            reject(new Error(`npm view command failed with code ${code}`));
          }
        });
      });

      if (output && output.includes('github.com')) {
        console.log(`Found repository URL: ${output}`);
        return output;
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.warn(`npm view command failed: ${error.message}`);
      } else {
        console.warn('npm view command failed with unknown error');
      }
    }

    console.log(`No repository URL found for package: ${packageName}. Will proceed with npm pack.`);
    return null;
  }

  private async installFromGitHub(packageDir: string, repoUrl: string): Promise<string> {
    console.log(`Cloning repository: ${repoUrl} to ${packageDir}`);

    // Create a directory for the source code
    const sourceDir = path.join(packageDir, 'source');
    await fs.mkdir(sourceDir, { recursive: true });

    // Clone the repository
    const cloneProc = spawn('git', ['clone', '--depth', '1', repoUrl, sourceDir], {
      stdio: 'pipe'
    });

    await new Promise((resolve, reject) => {
      cloneProc.on('close', (code) => {
        if (code === 0) {
          resolve(null);
        } else {
          reject(new Error(`Failed to clone repository: ${repoUrl}`));
        }
      });
    });

    // Install dependencies
    const installProc = spawn('npm', ['install'], {
      stdio: 'pipe',
      cwd: sourceDir
    });

    await new Promise((resolve, reject) => {
      installProc.on('close', (code) => {
        if (code === 0) {
          resolve(null);
        } else {
          reject(new Error(`Failed to install dependencies for repository: ${repoUrl}`));
        }
      });
    });

    return sourceDir;
  }
}