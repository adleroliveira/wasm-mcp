import { logger } from './logger.js';

// Types for worker communication
interface WorkerMessage {
  id: string;
  type: 'evaluate';
  code: string;
}

interface WorkerResponse {
  id: string;
  type: 'complete';
  success: boolean;
  error: { message: string; stack?: string; name?: string } | null;
  output?: string;
}

type WorkerType = import('worker_threads').Worker | globalThis.Worker;

// Sandbox configuration
interface SandboxConfig {
  allowedModules?: string[];
  blockedModules?: string[];
  moduleProxies?: { [moduleName: string]: any };
  preambleCode?: string;
  polyfills?: { [globalName: string]: any };
}

// Create a require function for ES modules
let require: (id: string) => any;
let createRequire: any;

const isNode = typeof window === 'undefined';

async function initializeNodeModules() {
  if (isNode) {
    const module = await import('module');
    createRequire = module.createRequire;
    require = createRequire(import.meta.url);
  }
}

/**
 * Evaluates JavaScript code in a sandboxed worker with configurable runtime control.
 */
export class WorkerEvaluator {
  private worker: WorkerType | null = null;
  private isBrowser: boolean;
  private messageHandlers: Array<(response: WorkerResponse) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private workerUrl: string | null = null;
  private static readonly EVALUATION_TIMEOUT_MS = 5000;
  private pendingEvaluations: Map<string, { resolve: () => void; reject: (error: Error) => void }> = new Map();
  private handlerCounter: number = 0;
  private sandboxConfig: SandboxConfig;

  constructor(sandboxConfig: SandboxConfig = {}) {
    this.isBrowser = typeof window !== 'undefined';
    this.sandboxConfig = {
      allowedModules: sandboxConfig.allowedModules || [],
      blockedModules: sandboxConfig.blockedModules || [],
      moduleProxies: sandboxConfig.moduleProxies || {},
      preambleCode: sandboxConfig.preambleCode || '',
      polyfills: sandboxConfig.polyfills || {}
    };
  }

  /**
   * Generates code for the process proxy.
   */
  private generateProcessProxyCode(): string {
    const processProxy = this.sandboxConfig.moduleProxies?.process;
    if (!processProxy) return '';

    const properties = Object.entries(processProxy).map(([key, value]) => {
      if (typeof value === 'function') {
        // Convert function to string, assuming simple return values
        try {
          const result = value();
          return `${key}: function() { return ${JSON.stringify(result)}; }`;
        } catch (e) {
          // Fallback for complex functions
          return `${key}: function() { return undefined; } // Function not serializable`;
        }
      }
      return `${key}: ${JSON.stringify(value)}`;
    });

    return `
      ${this.isBrowser ? 'self' : 'global'}.process = {
        ${properties.join(',\n        ')}
      };
    `;
  }

  /**
   * Registers event handlers.
   */
  on(event: 'message', handler: (response: WorkerResponse) => void): number;
  on(event: 'error', handler: (error: Error) => void): number;
  on(event: 'message' | 'error', handler: any): number {
    const handlerId = this.handlerCounter++;
    if (event === 'message') {
      this.messageHandlers.push(handler);
    } else {
      this.errorHandlers.push(handler);
    }
    return handlerId;
  }

  off(event: 'message', handler: (response: WorkerResponse) => void): void;
  off(event: 'error', handler: (error: Error) => void): void;
  off(event: 'message' | 'error', handler: any): void {
    if (event === 'message') {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    } else {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    }
  }

  /**
   * Generates worker code with sandboxing logic.
   */
  private generateWorkerCode(): string {
    const { allowedModules, blockedModules, moduleProxies, preambleCode, polyfills } = this.sandboxConfig;

    // Generate process proxy code
    const processProxyCode = this.generateProcessProxyCode();

    // Build sandboxed environment
    const sandboxCode = `
      // Process proxy
      ${processProxyCode}

      // Polyfills for globals
      const polyfills = ${JSON.stringify(polyfills)};
      const globalObject = typeof self !== 'undefined' ? self : global;
      Object.assign(globalObject, polyfills);

      // Module resolution override
      const originalRequire = typeof require === 'function' ? require : null;
      const moduleProxies = ${JSON.stringify(moduleProxies)};
      const allowedModules = ${JSON.stringify(allowedModules)};
      const blockedModules = ${JSON.stringify(blockedModules)};

      function customRequire(moduleName) {
        if (blockedModules.includes(moduleName)) {
          throw new Error(\`Module "\${moduleName}" is blocked\`);
        }
        if (!allowedModules.length || allowedModules.includes(moduleName)) {
          if (moduleProxies[moduleName]) {
            return moduleProxies[moduleName];
          }
          if (originalRequire) {
            return originalRequire(moduleName);
          }
        }
        throw new Error(\`Module "\${moduleName}" is not allowed\`);
      }

      // Override require (Node.js)
      if (originalRequire) {
        global.require = customRequire;
      }

      // Override import (browser)
      if (typeof self !== 'undefined') {
        self.importScripts = function() {
          throw new Error('importScripts is disabled in sandbox');
        };
      }

      // Preamble code
      ${preambleCode}
    `;

    const workerCode = this.isBrowser
      ? `
        ${sandboxCode}
        self.onmessage = function(event) {
          const { id, type, code } = event.data;
          if (type !== 'evaluate') {
            self.postMessage({
              id,
              type: 'complete',
              success: false,
              error: { message: 'Invalid message type' },
              output: ''
            });
            return;
          }

          try {
            const originalConsole = { ...console };
            const capturedOutput = [];
            console.log = (...args) => {
              const output = args.join(' ');
              capturedOutput.push(output);
              originalConsole.log.apply(console, args);
            };
            console.error = (...args) => {
              const output = 'ERROR: ' + args.join(' ');
              capturedOutput.push(output);
              originalConsole.error.apply(console, args);
            };
            console.warn = (...args) => {
              const output = 'WARN: ' + args.join(' ');
              capturedOutput.push(output);
              originalConsole.warn.apply(console, args);
            };

            const fn = new Function(code);
            fn();

            self.postMessage({
              id,
              type: 'complete',
              success: true,
              error: null,
              output: capturedOutput.join('\\n')
            });
          } catch (error) {
            self.postMessage({
              id,
              type: 'complete',
              success: false,
              error: { message: error.message, stack: error.stack, name: error.name },
              output: ''
            });
          }
        };
      `
      : `
        const { parentPort } = require('worker_threads');
        ${sandboxCode}
        parentPort.on('message', (message) => {
          const { id, type, code } = message;
          if (type !== 'evaluate') {
            parentPort.postMessage({
              id,
              type: 'complete',
              success: false,
              error: { message: 'Invalid message type' },
              output: ''
            });
            return;
          }

          try {
            const originalConsole = { ...console };
            const capturedOutput = [];
            console.log = (...args) => {
              const output = args.join(' ');
              capturedOutput.push(output);
              originalConsole.log.apply(console, args);
            };
            console.error = (...args) => {
              const output = 'ERROR: ' + args.join(' ');
              capturedOutput.push(output);
              originalConsole.error.apply(console, args);
            };
            console.warn = (...args) => {
              const output = 'WARN: ' + args.join(' ');
              capturedOutput.push(output);
              originalConsole.warn.apply(console, args);
            };

            const fn = new Function(code);
            fn();

            parentPort.postMessage({
              id,
              type: 'complete',
              success: true,
              error: null,
              output: capturedOutput.join('\\n')
            });
          } catch (error) {
            parentPort.postMessage({
              id,
              type: 'complete',
              success: false,
              error: { message: error.message, stack: error.stack, name: error.name },
              output: ''
            });
          }
        });
      `;

    return workerCode;
  }

  /**
   * Initializes the worker with sandboxed environment.
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      throw new Error('Worker already initialized');
    }

    try {
      await initializeNodeModules();

      const workerCode = this.generateWorkerCode();

      if (this.isBrowser) {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.workerUrl = URL.createObjectURL(blob);
        this.worker = new globalThis.Worker(this.workerUrl);
      } else {
        const { Worker } = await import('worker_threads');
        this.worker = new Worker(workerCode, { eval: true });
      }

      this.setupListeners();
    } catch (error) {
      logger.error('Failed to initialize worker:', error);
      await this.terminate();
      throw new Error(`Failed to initialize worker: ${error}`);
    }
  }

  /**
   * Sets up persistent listeners.
   */
  private setupListeners(): void {
    if (this.isBrowser) {
      (this.worker as globalThis.Worker).addEventListener('error', (event: ErrorEvent) => {
        logger.error('Worker error:', event);
        this.notifyErrorHandlers(new Error(`Worker error: ${event.message}`));
      });
      (this.worker as globalThis.Worker).addEventListener('message', (event: MessageEvent) => {
        this.handleWorkerMessage(event.data);
      });
    } else {
      (this.worker as import('worker_threads').Worker).on('error', (error: Error) => {
        logger.error('Worker error:', error);
        this.notifyErrorHandlers(error);
      });
      (this.worker as import('worker_threads').Worker).on('message', (data: any) => {
        this.handleWorkerMessage(data);
      });
    }
  }

  /**
   * Preprocesses code before evaluation.
   */
  private preprocessCode(code: string): string {
    let transformedCode = code;
    const importRegex = /import\s+.*?\s+from\s+['"](.*?)['"]/g;
    transformedCode = transformedCode.replace(importRegex, () => {
      throw new Error('Dynamic imports are disabled in sandbox');
    });
    return transformedCode;
  }

  /**
   * Evaluates code with callbacks.
   */
  evaluateWithCallback(code: string): void {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    if (!code || typeof code !== 'string') {
      throw new Error('JavaScript code must be a non-empty string');
    }
    if (code.length > 10000) {
      throw new Error('Code exceeds maximum length of 10,000 characters');
    }

    const preprocessedCode = this.preprocessCode(code);
    const id = `${Date.now()}-${Math.random()}`;
    const message: WorkerMessage = { id, type: 'evaluate', code: preprocessedCode };

    const messageHandler = (response: WorkerResponse) => {
      if (response.id === id) {
        this.off('message', messageHandler);
        const pending = this.pendingEvaluations.get(id);
        if (pending) {
          if (response.success) {
            if (response.output) {
              logger.info(response.output);
            }
            pending.resolve();
          } else {
            pending.reject(new Error(response.error?.message || 'Unknown error'));
          }
          this.pendingEvaluations.delete(id);
        }
        this.notifyMessageHandlers(response);
      }
    };

    this.on('message', messageHandler);
    this.worker.postMessage(message);

    setTimeout(() => {
      if (this.pendingEvaluations.has(id)) {
        this.off('message', messageHandler);
        const pending = this.pendingEvaluations.get(id);
        if (pending) {
          pending.reject(new Error('Callback evaluation timed out'));
          this.pendingEvaluations.delete(id);
        }
      }
    }, WorkerEvaluator.EVALUATION_TIMEOUT_MS);
  }

  /**
   * Asynchronously evaluates code.
   */
  async evaluate(code: string): Promise<void> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    if (!code || typeof code !== 'string') {
      throw new Error('JavaScript code must be a non-empty string');
    }
    if (code.length > 10000) {
      throw new Error('Code exceeds maximum length of 10,000 characters');
    }

    const preprocessedCode = this.preprocessCode(code);
    const id = `${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      this.pendingEvaluations.set(id, { resolve, reject });

      setTimeout(() => {
        if (this.pendingEvaluations.has(id)) {
          this.pendingEvaluations.delete(id);
          reject(new Error('Worker evaluation timed out'));
        }
      }, WorkerEvaluator.EVALUATION_TIMEOUT_MS);

      this.worker!.postMessage({ id, type: 'evaluate', code: preprocessedCode });
    });
  }

  /**
   * Handles worker messages.
   */
  private handleWorkerMessage(data: WorkerResponse): void {
    if (!data || typeof data !== 'object' || !data.id || data.type !== 'complete') {
      this.notifyErrorHandlers(new Error('Invalid worker response format'));
      return;
    }

    const pending = this.pendingEvaluations.get(data.id);
    if (pending) {
      if (data.success) {
        if (data.output) {
          logger.info('Worker output:', data.output);
        }
        // Signal completion first
        pending.resolve();
        // Then notify handlers
        this.notifyMessageHandlers(data);
      } else {
        pending.reject(new Error(data.error?.message || 'Unknown error'));
      }
      this.pendingEvaluations.delete(data.id);
    } else {
      this.notifyMessageHandlers(data);
    }
  }

  /**
   * Notifies message handlers.
   */
  private notifyMessageHandlers(response: WorkerResponse): void {
    this.messageHandlers.forEach(handler => handler(response));
  }

  /**
   * Notifies error handlers.
   */
  private notifyErrorHandlers(error: Error): void {
    this.errorHandlers.forEach(handler => handler(error));
  }

  /**
   * Terminates the worker.
   */
  async terminate(): Promise<void> {
    if (!this.worker) {
      return;
    }

    logger.info('Starting worker termination...');
    try {
      // Clear all handlers and pending evaluations first
      this.messageHandlers = [];
      this.errorHandlers = [];
      this.pendingEvaluations.clear();

      if (this.isBrowser) {
        logger.info('Terminating browser worker...');
        (this.worker as globalThis.Worker).terminate();
        if (this.workerUrl) {
          logger.info('Revoking worker URL...');
          URL.revokeObjectURL(this.workerUrl);
          this.workerUrl = null;
        }
      } else {
        logger.info('Terminating Node.js worker...');
        const worker = this.worker as import('worker_threads').Worker;
        await worker.terminate();
      }
    } catch (error) {
      logger.warn(`Failed to terminate worker: ${error}`);
    } finally {
      this.worker = null;
      logger.info('Worker termination complete');
    }
  }
}