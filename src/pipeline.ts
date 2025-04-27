import { promises as fs } from 'fs';
import path from 'path';
import { Installer, MCPServerConfig } from './installer.js';
import { Bundler } from './bundler.js';
import { Analyzer } from './analyzer.js';

export interface PipelineOptions {
  debugDir?: string;
  packagesDir?: string;
}

export class Pipeline {
  private debugDir: string;
  private packagesDir: string;
  private installer: Installer;
  private currentPhase: string = '';

  constructor(options: PipelineOptions = {}) {
    this.debugDir = options.debugDir || './debug';
    this.packagesDir = options.packagesDir || './packages';
    this.installer = new Installer({ path: this.packagesDir });
  }

  private async ensureDebugDir(): Promise<void> {
    try {
      await fs.mkdir(this.debugDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create debug directory:', error);
      throw error;
    }
  }

  private logPhase(phase: string, message: string): void {
    this.currentPhase = phase;
    console.log(`[${phase}] ${message}`);
  }

  private async saveDebugArtifact(name: string, content: any): Promise<void> {
    const artifactPath = path.join(this.debugDir, `${name}.json`);
    await fs.writeFile(artifactPath, JSON.stringify(content, null, 2));
    console.log(`Debug artifact saved: ${artifactPath}`);
  }

  async run(serverConfig: MCPServerConfig, projectName: string): Promise<void> {
    try {
      await this.ensureDebugDir();

      // Phase 1: Installation
      this.logPhase('Installation', 'Starting package installation...');
      await this.installer.initDir();
      const installDir = await this.installer.install(serverConfig, projectName);
      await this.saveDebugArtifact('installation', { installDir, serverConfig });
      this.logPhase('Installation', 'Package installed successfully');

      // Phase 2: Bundling
      this.logPhase('Bundling', 'Starting bundling phase...');
      const bundler = new Bundler({
        packageDir: installDir,
        outDir: path.join(installDir, 'dist'),
        artifactsDir: path.join(installDir, 'artifacts')
      });
      const bundlePath = await bundler.bundle();
      await this.saveDebugArtifact('bundling', { bundlePath });
      this.logPhase('Bundling', 'Bundling completed');

      // Phase 3: Analysis
      this.logPhase('Analysis', 'Starting analysis phase...');
      const analyzer = new Analyzer({
        packageDir: installDir,
        artifactsDir: path.join(installDir, 'artifacts')
      });
      const analysis = await analyzer.analyze();
      await this.saveDebugArtifact('analysis', analysis);
      this.logPhase('Analysis', 'Analysis completed');

      // Phase 4: WASM Compilation (placeholder for now)
      this.logPhase('WASM Compilation', 'Starting WASM compilation...');
      // TODO: Implement WASM compilation phase
      this.logPhase('WASM Compilation', 'WASM compilation completed');

    } catch (error) {
      console.error(`Error in phase "${this.currentPhase}":`, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
} 