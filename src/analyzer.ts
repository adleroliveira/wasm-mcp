import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'acorn';
import * as walk from 'acorn-walk';

export interface AnalyzerOptions {
  packageDir: string;
  artifactsDir: string;
}

export interface ImportAnalysis {
  nonStandardImports: string[];
  nodeGlobals: string[];
  nodeStandardModules: string[];
}

export class Analyzer {
  private packageDir: string;
  private artifactsDir: string;

  private readonly nodeStandardModules = new Set([
    'assert',           // Assertion testing
    'async_hooks',      // Tracking asynchronous resources
    'buffer',           // Binary data handling (distinct from ArrayBuffer)
    'child_process',    // Spawning child processes
    'cluster',          // Multi-core process management
    'console',          // Node.js-specific console features
    'crypto',           // Cryptographic utilities (beyond browser crypto)
    'dgram',            // UDP/datagram sockets
    'diagnostics_channel', // Diagnostic event channels
    'dns',              // DNS resolution
    'domain',           // Deprecated error handling
    'events',           // EventEmitter (distinct from EventTarget)
    'fs',               // File system operations
    'http',             // HTTP server/client
    'http2',            // HTTP/2 server/client
    'https',            // HTTPS server/client
    'inspector',        // Debugging interface
    'module',           // Module system utilities
    'net',              // TCP/IPC networking
    'os',               // Operating system information
    'path',             // File system path utilities
    'perf_hooks',       // Performance measurement
    'process',          // Process information and control
    'readline',         // Line-by-line input processing
    'repl',             // Read-eval-print loop
    'stream',           // Stream API (distinct from ReadableStream)
    'timers',           // Node.js-specific timer behaviors
    'tls',              // TLS/SSL networking
    'tty',              // Terminal device handling
    'util',             // Utility functions (e.g., promisify)
    'v8',               // V8 engine utilities
    'vm',               // Virtual machine for isolated code
    'worker_threads',   // Multi-threading
    'zlib'              // Compression
  ]);

  // List of Node.js-specific globals that need to be polyfilled
  // These are globals that are NOT available in browsers by default
  private readonly nodeGlobals = new Set([
    'process',           // Node.js process information and control
    'Buffer',           // Binary data handling
    'global',           // Node.js global namespace (unlike window/self in browsers)
    '__dirname',        // Directory name of the current module
    '__filename',       // Filename of the current module
    'setImmediate',     // Immediate callback execution
    'clearImmediate',   // Cancel setImmediate
    'module',           // CommonJS module object
    'exports',          // CommonJS module.exports
    'require',          // CommonJS module import function
    'crypto',           // Node.js cryptographic utilities (distinct from browser's window.crypto)
    'stream',           // Node.js streams (distinct from browser ReadableStream/WritableStream)
    'util',             // Node.js utility functions (e.g., promisify, format)
    'domain',           // Deprecated Node.js error handling
    'vm',               // Node.js virtual machine for isolated code execution
    'EventEmitter'      // Node.js event emitter (distinct from browser EventTarget)
  ]);

  constructor(options: AnalyzerOptions) {
    this.packageDir = options.packageDir;
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

  private async saveArtifact(name: string, content: any): Promise<void> {
    const artifactPath = path.join(this.artifactsDir, `${name}.json`);
    await fs.writeFile(artifactPath, JSON.stringify(content, null, 2));
    console.log(`Artifact saved: ${artifactPath}`);
  }

  private async analyzeFile(filePath: string): Promise<ImportAnalysis> {
    const content = await fs.readFile(filePath, 'utf-8');
    const ast = parse(content, {
      sourceType: 'module',
      ecmaVersion: 'latest'
    });

    const analysis: ImportAnalysis = {
      nonStandardImports: [],
      nodeGlobals: [],
      nodeStandardModules: []
    };

    // Use Sets to track unique values
    const nonStandardImports = new Set<string>();
    const usedNodeGlobals = new Set<string>();
    const usedNodeModules = new Set<string>();

    const visitors = {
      ImportDeclaration: (node: any) => {
        const source = node.source.value;

        // Track any import that is not a relative or absolute path
        if (!source.startsWith('./') &&
          !source.startsWith('../') &&
          !source.startsWith('/')) {
          nonStandardImports.add(source);

          // Check if it's a Node.js standard module
          if (this.nodeStandardModules.has(source)) {
            usedNodeModules.add(source);
          }
        }
      },
      CallExpression: (node: any) => {
        // Check for require() calls
        if (node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal') {
          const source = node.arguments[0].value;

          // Check if it's a Node.js standard module
          if (this.nodeStandardModules.has(source)) {
            usedNodeModules.add(source);
          }
        }
      },
      MemberExpression: (node: any) => {
        // Check for process.cwd(), process.env, etc.
        if (node.object.type === 'Identifier' &&
          this.nodeGlobals.has(node.object.name)) {
          usedNodeGlobals.add(node.object.name);
        }
      },
      Identifier: (node: any) => {
        // Check for direct usage of globals like process, Buffer, etc.
        if (this.nodeGlobals.has(node.name)) {
          usedNodeGlobals.add(node.name);
        }
      }
    };

    walk.simple(ast, visitors);

    // Convert Sets to arrays for the final result
    analysis.nonStandardImports = Array.from(nonStandardImports).sort();
    analysis.nodeGlobals = Array.from(usedNodeGlobals).sort();
    analysis.nodeStandardModules = Array.from(usedNodeModules).sort();

    return analysis;
  }

  async analyze(): Promise<ImportAnalysis> {
    try {
      await this.ensureArtifactsDir();

      // Analyze bundled file
      const bundlePath = path.join(this.packageDir, 'dist', 'bundle.js');
      const bundleAnalysis = await this.analyzeFile(bundlePath);
      await this.saveArtifact('bundle-imports', bundleAnalysis);

      return bundleAnalysis;

    } catch (error) {
      console.error('Analysis failed:', error);
      throw error;
    }
  }
}
