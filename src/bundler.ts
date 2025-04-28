import * as esbuild from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';

export interface BundlerOptions {
  packageDir: string;
  outDir: string;
  artifactsDir: string;
}

export class Bundler {
  private packageDir: string;
  private outDir: string;
  private artifactsDir: string;
  private entryPoint: string | null = null;

  constructor(options: BundlerOptions) {
    this.packageDir = options.packageDir;
    this.outDir = options.outDir;
    this.artifactsDir = options.artifactsDir;
  }

  private async ensureArtifactsDir(): Promise<void> {
    try {
      await fs.mkdir(this.artifactsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create artifacts directory:', error);
      throw error;
    }
  }

  private async readPackageJson(): Promise<any> {
    try {
      const packageJsonPath = path.join(this.packageDir, 'source', 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to read package.json:', error);
      throw error;
    }
  }

  private async resolveEntryPoint(): Promise<string> {
    if (this.entryPoint) return this.entryPoint;

    const packageJson = await this.readPackageJson();
    if (!packageJson.bin) {
      throw new Error('No bin property found in package.json');
    }

    // If bin is a string, use it directly
    if (typeof packageJson.bin === 'string') {
      this.entryPoint = path.join(this.packageDir, 'source', packageJson.bin);
      return this.entryPoint;
    }

    // If bin is an object, use the first entry
    const firstBin = Object.values(packageJson.bin)[0];
    if (typeof firstBin === 'string') {
      this.entryPoint = path.join(this.packageDir, 'source', firstBin);
      return this.entryPoint;
    }

    throw new Error('Could not resolve entry point from package.json bin property');
  }

  private async getModuleFormat(): Promise<'esm' | 'cjs'> {
    const packageJson = await this.readPackageJson();
    return packageJson.type === 'module' ? 'esm' : 'cjs';
  }

  async bundle(): Promise<string> {
    try {
      await this.ensureArtifactsDir();
      const entryPoint = await this.resolveEntryPoint();
      const format = await this.getModuleFormat();

      // Bundle the code with optimizations
      const result = await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        outfile: path.join(this.outDir, 'bundle.js'),
        platform: 'node',
        target: 'node16',
        format,
        sourcemap: true,
        metafile: true,
        // Optimization options
        minify: true, // Enable minification
        minifyWhitespace: true, // Remove whitespace
        minifyIdentifiers: true, // Shorten identifiers
        minifySyntax: true, // Optimize syntax
        treeShaking: true, // Remove unused code
        legalComments: 'none', // Remove legal comments
        // Advanced optimizations
        define: {
          'process.env.NODE_ENV': '"production"', // Enable production optimizations
        },
        // Code splitting (if needed)
        splitting: false, // Set to true if you want to enable code splitting
        chunkNames: 'chunks/[name]-[hash]',
      });

      // Save metadata
      await fs.writeFile(
        path.join(this.artifactsDir, 'metadata.json'),
        JSON.stringify(result.metafile, null, 2)
      );

      // Log bundle size information
      const bundlePath = path.join(this.outDir, 'bundle.js');
      const stats = await fs.stat(bundlePath);
      console.log(`Bundle size: ${(stats.size / 1024).toFixed(2)} KB`);

      return bundlePath;
    } catch (error) {
      console.error('Bundling failed:', error);
      throw error;
    }
  }
}
