import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'acorn';
import * as walk from 'acorn-walk';

export interface AnalyzerOptions {
  packageDir: string;
  artifactsDir: string;
}

export interface SymbolAnalysis {
  functions: {
    name: string;
    parameters: string[];
  }[];
  classes: {
    name: string;
    methods: string[];
  }[];
  variables: string[];
  exports: string[];
  nonStandardImports: {
    node: string[];
    browser: string[];
    other: string[];
  };
}

export class Analyzer {
  private packageDir: string;
  private artifactsDir: string;

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

  private async analyzeFile(filePath: string): Promise<SymbolAnalysis> {
    const content = await fs.readFile(filePath, 'utf-8');
    const ast = parse(content, {
      sourceType: 'module',
      ecmaVersion: 'latest'
    });

    const analysis: SymbolAnalysis = {
      functions: [],
      classes: [],
      variables: [],
      exports: [],
      nonStandardImports: {
        node: [],
        browser: [],
        other: []
      }
    };

    // Use Sets to track unique imports
    const nodeImports = new Set<string>();
    const browserImports = new Set<string>();
    const otherImports = new Set<string>();

    walk.simple(ast, {
      FunctionDeclaration(node: any) {
        if (node.id) {
          analysis.functions.push({
            name: node.id.name,
            parameters: node.params.map((param: any) => param.name)
          });
        }
      },
      ClassDeclaration(node: any) {
        if (node.id) {
          const methods = node.body.body
            .filter((method: any) => method.type === 'MethodDefinition')
            .map((method: any) => method.key.name);

          analysis.classes.push({
            name: node.id.name,
            methods
          });
        }
      },
      VariableDeclaration(node: any) {
        node.declarations.forEach((decl: any) => {
          if (decl.id.type === 'Identifier') {
            analysis.variables.push(decl.id.name);
          }
        });
      },
      ExportNamedDeclaration(node: any) {
        if (node.declaration) {
          if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
            analysis.exports.push(node.declaration.id.name);
          } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
            analysis.exports.push(node.declaration.id.name);
          } else if (node.declaration.type === 'VariableDeclaration') {
            node.declaration.declarations.forEach((decl: any) => {
              if (decl.id.type === 'Identifier') {
                analysis.exports.push(decl.id.name);
              }
            });
          }
        }
        if (node.specifiers) {
          node.specifiers.forEach((specifier: any) => {
            if (specifier.exported) {
              analysis.exports.push(specifier.exported.name);
            }
          });
        }
      },
      ExportDefaultDeclaration(node: any) {
        if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          analysis.exports.push(node.declaration.id.name);
        } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
          analysis.exports.push(node.declaration.id.name);
        } else if (node.declaration.type === 'Identifier') {
          analysis.exports.push(node.declaration.name);
        }
      },
      ImportDeclaration(node: any) {
        const source = node.source.value;

        // Check for Node.js built-in modules
        if (source.startsWith('node:') ||
          ['fs', 'path', 'http', 'https', 'crypto', 'stream', 'util', 'events', 'buffer', 'os', 'net', 'dns', 'zlib', 'child_process', 'cluster', 'dgram', 'tls', 'tty', 'url', 'v8', 'vm', 'worker_threads'].includes(source)) {
          nodeImports.add(source);
        }
        // Check for browser APIs
        else if (source.startsWith('window:') ||
          ['document', 'window', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'fetch', 'WebSocket', 'XMLHttpRequest', 'Blob', 'File', 'FormData', 'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'crypto', 'performance', 'console', 'alert', 'confirm', 'prompt'].includes(source)) {
          browserImports.add(source);
        }
        // Other non-standard imports
        else if (!source.startsWith('.') && !source.startsWith('/')) {
          otherImports.add(source);
        }
      }
    });

    // Convert Sets to arrays for the final result
    analysis.nonStandardImports = {
      node: Array.from(nodeImports),
      browser: Array.from(browserImports),
      other: Array.from(otherImports)
    };

    return analysis;
  }

  async analyze(): Promise<{ source: SymbolAnalysis; bundle: SymbolAnalysis }> {
    try {
      await this.ensureArtifactsDir();

      // Analyze source file
      const sourcePath = path.join(this.packageDir, 'source', 'dist', 'index.js');
      const sourceAnalysis = await this.analyzeFile(sourcePath);
      await this.saveArtifact('source-symbols', sourceAnalysis);

      // Analyze bundled file
      const bundlePath = path.join(this.packageDir, 'dist', 'bundle.js');
      const bundleAnalysis = await this.analyzeFile(bundlePath);
      await this.saveArtifact('bundle-symbols', bundleAnalysis);

      return {
        source: sourceAnalysis,
        bundle: bundleAnalysis
      };

    } catch (error) {
      console.error('Analysis failed:', error);
      throw error;
    }
  }
}
