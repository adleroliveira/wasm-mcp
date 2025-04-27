import { logger } from './logger.js';

// Types for worker communication.
interface WorkerMessage {
  id: string;
  type: 'evaluate';
  code: string;
}

interface WorkerResponse {
  id: string;
  type: 'complete';
  success: boolean;
  error: string | null;
  output: string;
}

type WorkerType = import('worker_threads').Worker | globalThis.Worker;

/**
 * Evaluates JavaScript code in a worker (Web Worker for browser, Worker Thread for Node.js).
 * Supports synchronous evaluation via callbacks for WASM integration.
 */
export class WorkerEvaluator {
  private worker: WorkerType | null = null;
  private isBrowser: boolean;
  private messageHandlers: Map<string, Array<(response: WorkerResponse) => void>> = new Map();
  private errorHandlers: Array<(error: Error) => void> = [];
  private workerUrl: string | null = null;
  private static readonly EVALUATION_TIMEOUT_MS = 5000; // 5-second timeout for evaluations.
  private pendingEvaluations: Map<string, { resolve: () => void; reject: (error: Error) => void }> = new Map();

  constructor() {
    this.isBrowser = typeof window !== 'undefined';
  }

  /**
   * Registers an event handler for worker messages or errors.
   * @param event The event type ('message' or 'error').
   * @param handler The callback for messages (WorkerResponse) or errors (Error).
   */
  on(event: 'message', handler: (response: WorkerResponse) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'message' | 'error', handler: any): void {
    if (event === 'message') {
      this.messageHandlers.set(handler.toString(), [
        ...(this.messageHandlers.get(handler.toString()) || []),
        handler,
      ]);
    } else {
      this.errorHandlers.push(handler);
    }
  }

  /**
   * Removes an event handler.
   * @param event The event type ('message' or 'error').
   * @param handler The callback to remove.
   */
  off(event: 'message', handler: (response: WorkerResponse) => void): void;
  off(event: 'error', handler: (error: Error) => void): void;
  off(event: 'message' | 'error', handler: any): void {
    if (event === 'message') {
      this.messageHandlers.delete(handler.toString());
    } else {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    }
  }

  /**
   * Initializes the worker.
   * @throws Error if worker creation fails.
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      throw new Error('Worker already initialized');
    }

    try {
      if (this.isBrowser) {
        // Create a data URL for the worker code
        const workerCode = `
          // Worker code
          self.onmessage = function(event) {
            const { id, type, code } = event.data;
            if (type !== 'evaluate') {
              self.postMessage({
                id,
                type: 'complete',
                success: false,
                error: 'Invalid message type',
                output: ''
              });
              return;
            }

            try {
              // Override console methods to capture output
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

              // Evaluate the code
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
                error: error.message || 'Unknown error',
                output: ''
              });
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.workerUrl = URL.createObjectURL(blob);
        this.worker = new globalThis.Worker(this.workerUrl);
      } else {
        // For Node.js, create a temporary worker file
        const { Worker } = await import('worker_threads');
        const { writeFileSync, unlinkSync } = await import('fs');
        const { tmpdir } = await import('os');
        const { join } = await import('path');

        const workerCode = `
          const { parentPort } = require('worker_threads');

          // Simple logger implementation for the worker
          const logger = {
            debug: (...args) => parentPort.postMessage({ type: 'log', level: 'debug', args }),
            info: (...args) => parentPort.postMessage({ type: 'log', level: 'info', args }),
            warn: (...args) => parentPort.postMessage({ type: 'log', level: 'warn', args }),
            error: (...args) => parentPort.postMessage({ type: 'log', level: 'error', args })
          };

          parentPort.on('message', (message) => {
            const { id, type, code } = message;
            if (type !== 'evaluate') {
              parentPort.postMessage({
                id,
                type: 'complete',
                success: false,
                error: 'Invalid message type',
                output: ''
              });
              return;
            }

            try {
              // Override console methods to capture output
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

              // Evaluate the code
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
                error: error.message || 'Unknown error',
                output: ''
              });
            }
          });
        `;

        const workerPath = join(tmpdir(), `worker-${Date.now()}.js`);
        writeFileSync(workerPath, workerCode);
        this.worker = new Worker(workerPath);

        // Clean up the temporary file when the worker is terminated
        this.worker.on('exit', () => {
          try {
            unlinkSync(workerPath);
          } catch (error) {
            logger.warn('Failed to clean up temporary worker file:', error);
          }
        });
      }

      // Set up error handling and log message handling
      if (this.isBrowser) {
        (this.worker as globalThis.Worker).addEventListener('error', (event: ErrorEvent) => {
          logger.error('Worker error:', event);
          this.notifyErrorHandlers(new Error(`Worker error: ${event.message}`));
        });
        (this.worker as globalThis.Worker).addEventListener('message', (event: MessageEvent) => {
          const data = event.data;
          if (data.type === 'log') {
            switch (data.level) {
              case 'debug':
                logger.debug(...data.args);
                break;
              case 'info':
                logger.info(...data.args);
                break;
              case 'warn':
                logger.warn(...data.args);
                break;
              case 'error':
                logger.error(...data.args);
                break;
            }
          }
        });
      } else {
        (this.worker as import('worker_threads').Worker).on('error', (error: Error) => {
          logger.error('Worker error:', error);
          this.notifyErrorHandlers(error);
        });
        (this.worker as import('worker_threads').Worker).on('message', (data: any) => {
          if (data.type === 'log') {
            switch (data.level) {
              case 'debug':
                logger.debug(...data.args);
                break;
              case 'info':
                logger.info(...data.args);
                break;
              case 'warn':
                logger.warn(...data.args);
                break;
              case 'error':
                logger.error(...data.args);
                break;
            }
          }
        });
      }
    } catch (error) {
      logger.error('Failed to initialize worker:', error);
      await this.terminate();
      throw new Error(`Failed to initialize worker: ${error}`);
    }
  }

  /**
   * Synchronously evaluates JavaScript code by queuing it for worker execution.
   * Uses callbacks to notify WASM of completion (since true sync evaluation is infeasible).
   * @param code The JavaScript code to evaluate.
   * @throws Error if the worker is not initialized or code is invalid.
   */
  evaluateSync(code: string): void {
    logger.debug('WorkerEvaluator: Starting evaluateSync with code:', code);
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    if (!code) {
      throw new Error('JavaScript code cannot be empty');
    }

    // Generate a unique ID for this evaluation.
    const id = `${Date.now()}-${Math.random()}`;
    logger.debug('WorkerEvaluator: Generated message ID:', id);
    const message: WorkerMessage = { id, type: 'evaluate', code };

    // Set up a temporary message handler for this evaluation.
    const messageHandler = (response: WorkerResponse) => {
      logger.debug('WorkerEvaluator: Received response:', JSON.stringify(response, null, 2));
      if (response.id === id) {
        logger.debug('WorkerEvaluator: Processing response for ID:', id);
        this.off('message', messageHandler);
        const pending = this.pendingEvaluations.get(id);
        if (pending) {
          if (response.success) {
            logger.debug('WorkerEvaluator: Success response, displaying output:', response.output);
            // Display the output from the worker
            if (response.output) {
              logger.info(response.output);
            }
            pending.resolve();
          } else {
            logger.error('WorkerEvaluator: Error response:', response.error);
            pending.reject(new Error(response.error || 'Unknown error'));
          }
          this.pendingEvaluations.delete(id);
        }
        this.notifyMessageHandlers(response);
      }
    };

    // Register the handler and send the message.
    logger.debug('WorkerEvaluator: Registering message handler and sending message');
    this.on('message', messageHandler);
    this.worker.postMessage(message);

    // Set up the message listener (persistent for async responses).
    if (!this.pendingEvaluations.has(id)) {
      logger.debug('WorkerEvaluator: Setting up message listener');
      if (this.isBrowser) {
        (this.worker as globalThis.Worker).addEventListener('message', (event: MessageEvent) => {
          logger.debug('WorkerEvaluator: Received browser worker message:', JSON.stringify(event.data, null, 2));
          this.handleWorkerMessage(event.data);
        }, { once: true });
      } else {
        (this.worker as import('worker_threads').Worker).once('message', (data: WorkerResponse) => {
          logger.debug('WorkerEvaluator: Received Node.js worker message:', JSON.stringify(data, null, 2));
          this.handleWorkerMessage(data);
        });
      }
    }
  }

  /**
   * Asynchronously evaluates JavaScript code (for non-WASM use cases).
   * @param code The JavaScript code to evaluate.
   * @returns A promise that resolves on success or rejects on failure.
   */
  async evaluate(code: string): Promise<void> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    if (!code) {
      throw new Error('JavaScript code cannot be empty');
    }

    const id = `${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      this.pendingEvaluations.set(id, { resolve, reject });

      // Set timeout for evaluation.
      const timeout = setTimeout(() => {
        this.pendingEvaluations.delete(id);
        reject(new Error('Worker evaluation timed out'));
      }, WorkerEvaluator.EVALUATION_TIMEOUT_MS);

      // Send the message.
      this.worker!.postMessage({ id, type: 'evaluate', code });

      // Note: Message handler is set up in evaluateSync or initialize.
    });
  }

  /**
   * Handles incoming worker messages.
   * @param data The worker's response.
   */
  private handleWorkerMessage(data: WorkerResponse): void {
    if (!data || typeof data !== 'object' ||
      !data.id ||
      data.type !== 'complete' ||
      typeof data.success !== 'boolean' ||
      typeof data.error !== 'string' && data.error !== null ||
      typeof data.output !== 'string') {
      this.notifyErrorHandlers(new Error('Invalid worker response format'));
      return;
    }

    const pending = this.pendingEvaluations.get(data.id);
    if (pending) {
      if (data.success) {
        // Display the output from the worker
        if (data.output) {
          logger.info('Worker output:', data.output);
        }
        pending.resolve();
      } else {
        pending.reject(new Error(data.error || 'Unknown error'));
      }
      this.pendingEvaluations.delete(data.id);
    }
    this.notifyMessageHandlers(data);
  }

  /**
   * Notifies message handlers with the response.
   * @param response The worker's response.
   */
  private notifyMessageHandlers(response: WorkerResponse): void {
    this.messageHandlers.forEach(handlers => {
      handlers.forEach(handler => handler(response));
    });
  }

  /**
   * Notifies error handlers with the error.
   * @param error The error to report.
   */
  private notifyErrorHandlers(error: Error): void {
    this.errorHandlers.forEach(handler => handler(error));
  }

  /**
   * Terminates the worker and cleans up resources.
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      try {
        if (this.isBrowser) {
          (this.worker as globalThis.Worker).terminate();
          if (this.workerUrl) {
            URL.revokeObjectURL(this.workerUrl);
            this.workerUrl = null;
          }
        } else {
          await (this.worker as import('worker_threads').Worker).terminate();
        }
      } catch (error) {
        logger.warn(`Failed to terminate worker: ${error}`);
      }
      this.worker = null;
    }
    this.messageHandlers.clear();
    this.errorHandlers = [];
    this.pendingEvaluations.clear();
  }
}