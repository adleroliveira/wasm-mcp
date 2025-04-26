import { spawn } from 'child_process';
import { promises as fs } from 'fs';
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

    // Download the package tarball
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

    // Install dependencies with --omit=dev to install only production dependencies
    console.log(`Installing dependencies in ${sourceDir}`);
    const installProc = spawn('npm', [
      'install',
      '--omit=dev',
      '--no-save',
      '--prefer-offline',
      '--no-audit',
      '--no-package-lock',
      '--ignore-scripts'
    ], {
      stdio: 'pipe',
      cwd: sourceDir,
      env: {
        ...process.env,
        // Ensure npm doesn't use the parent project's node_modules
        NODE_PATH: undefined
      }
    });

    // Capture and log stdout
    installProc.stdout.on('data', (data) => {
      // console.log(`npm stdout: ${data.toString()}`);
    });

    // Capture and log stderr
    installProc.stderr.on('data', (data) => {
      console.error(`npm stderr: ${data.toString()}`);
    });

    await new Promise((resolve, reject) => {
      installProc.on('close', (code) => {
        if (code === 0) {
          console.log('npm install completed successfully');
          resolve(null);
        } else {
          console.error(`npm install failed with exit code: ${code}`);
          reject(new Error(`Failed to install dependencies for package: ${packageName}`));
        }
      });
    });

    return packageDir;
  }
}