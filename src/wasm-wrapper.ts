import { instantiate, ASUtil } from '@assemblyscript/loader';
import { WorkerEvaluator } from './worker-evaluator.js';
import { logger } from './logger.js';

// Type definitions for WASM module exports.
interface MyWasmExports extends ASUtil {
  [key: string]: unknown;
  run: () => void;
  runJSCode: (jsCodePtr: number) => void;
  embedJSCode: (jsPathPtr: number) => number;
  __new: (size: number, id: number) => number;
  __newString: (str: string) => number;
  __free: (ptr: number) => void;
  __pin: (ptr: number) => number;
  __unpin: (ptr: number) => void;
  __collect: () => void;
  memory: WebAssembly.Memory;
}

/**
 * Manages a WebAssembly module that executes JavaScript code in a worker.
 * Provides a user-friendly API for running WASM functions and handles WASM imports.
 */
export class WasmRunner {
  private instance: { exports: MyWasmExports } | null = null;
  private workerEvaluator: WorkerEvaluator | null = null;
  private static readonly MAX_JS_CODE_SIZE = 1024 * 1024; // 1MB max JavaScript code size.

  /**
   * Initializes the WASM module and worker evaluator.
   * @param wasmSource Path to the WASM file (browser) or buffer (Node.js).
   * @throws Error if initialization fails.
   */
  async initialize(wasmSource: string | ArrayBuffer | Uint8Array): Promise<void> {
    // Initialize worker evaluator.
    this.workerEvaluator = new WorkerEvaluator({
      moduleProxies: {
        process: {
          cwd: () => '/mocked/cwd/path',
          platform: 'mocked-platform',
          env: { NODE_ENV: 'sandbox' }
        }
      }
    });
    try {
      await this.workerEvaluator.initialize();
    } catch (error) {
      throw new Error(`Failed to initialize WorkerEvaluator: ${error}`);
    }

    // Define WASM imports.
    const imports = {
      index: {
        /**
         * Evaluates JavaScript code in the worker.
         * @param ptr Pointer to UTF-8 encoded code in WASM memory.
         * @param length Length of the code (excluding null terminator).
         */
        evaluate: (ptr: number, length: number) => {
          if (!this.instance) {
            throw new Error('WASM instance not initialized');
          }
          const memory = this.instance.exports.memory;
          if (ptr < 0 || length < 0 || ptr + length > memory.buffer.byteLength) {
            throw new Error(`Invalid memory access: ptr=${ptr}, length=${length}`);
          }
          const rawBytes = new Uint8Array(memory.buffer, ptr, length);
          const jsCode = new TextDecoder().decode(rawBytes).trim();
          // Note: evaluate is synchronous to match AssemblyScript declaration.
          // WorkerEvaluator must handle async execution internally.
          this.workerEvaluator!.evaluateWithCallback(jsCode);
        },
        __new: (size: number, id: number) => this.instance!.exports.__new(size, id),
        __pin: (ptr: number) => this.instance!.exports.__pin(ptr),
        __unpin: (ptr: number) => this.instance!.exports.__unpin(ptr),
        __collect: () => this.instance!.exports.__collect(),
        /**
         * Copies n bytes from src to dest in WASM memory.
         */
        memory_copy: (dest: number, src: number, n: number) => {
          const memory = this.instance!.exports.memory;
          if (
            dest < 0 ||
            src < 0 ||
            n < 0 ||
            dest + n > memory.buffer.byteLength ||
            src + n > memory.buffer.byteLength
          ) {
            throw new Error(`Invalid memory_copy: dest=${dest}, src=${src}, n=${n}`);
          }
          const destArray = new Uint8Array(memory.buffer, dest, n);
          const srcArray = new Uint8Array(memory.buffer, src, n);
          destArray.set(srcArray);
        },
        __free: (ptr: number) => {
          // No-op: Memory is managed by the WASM module's garbage collector.
        },
      },
      env: {
        /**
         * Handles WASM runtime aborts.
         */
        abort: (msg: number, file: number, line: number, column: number) => {
          throw new Error(`WASM abort at ${file}:${line}:${column}, message=${msg}`);
        },
      },
    };

    // Instantiate WASM module.
    try {
      if (typeof wasmSource === 'string') {
        const response = await fetch(wasmSource);
        if (!response.ok) {
          throw new Error(`Failed to fetch WASM file: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        this.instance = await instantiate<MyWasmExports>(buffer, imports);
      } else {
        if (!(wasmSource instanceof ArrayBuffer) && !(wasmSource instanceof Uint8Array)) {
          throw new Error('Invalid wasmSource: must be string, ArrayBuffer, or Uint8Array');
        }
        this.instance = await instantiate<MyWasmExports>(wasmSource, imports);
      }
    } catch (error) {
      await this.destroy(); // Clean up workerEvaluator on failure.
      throw new Error(`Failed to instantiate WASM module: ${error}`);
    }

    // Validate required exports.
    if (!this.instance.exports.run || !this.instance.exports.runJSCode || !this.instance.exports.__newString) {
      await this.destroy();
      throw new Error('Required WASM exports (run, runJSCode, __newString) are missing');
    }
  }

  /**
   * Runs the WASM module's default JavaScript code.
   * @throws Error if the WASM module or worker fails.
   */
  async run(): Promise<void> {
    if (!this.instance || !this.workerEvaluator) {
      throw new Error('WASMRunner not initialized');
    }
    try {
      this.instance.exports.run();
      await this.waitForWorkerCompletion();
    } catch (error) {
      await this.destroy();
      throw new Error(`Failed to run WASM module: ${error}`);
    }
  }

  /**
   * Runs the provided JavaScript code via the WASM module.
   * @param jsCode The JavaScript code to execute.
   * @throws Error if the code is invalid or execution fails.
   */
  async runJSCode(jsCode: string): Promise<void> {
    if (!this.instance || !this.workerEvaluator) {
      throw new Error('WASMRunner not initialized');
    }
    if (!jsCode) {
      throw new Error('JavaScript code cannot be empty');
    }
    if (jsCode.length > WasmRunner.MAX_JS_CODE_SIZE) {
      throw new Error(`JavaScript code exceeds maximum size of ${WasmRunner.MAX_JS_CODE_SIZE} bytes`);
    }
    try {
      const strPtr = this.instance.exports.__newString(jsCode);
      this.instance.exports.runJSCode(strPtr);
      await this.waitForWorkerCompletion();
    } catch (error) {
      await this.destroy();
      throw new Error(`Failed to run JavaScript code: ${error}`);
    }
  }

  /**
   * Waits for the worker to signal completion.
   * @returns A promise that resolves when the worker completes.
   */
  private async waitForWorkerCompletion(): Promise<void> {
    return new Promise((resolve, reject) => {
      const messageHandler = (msg: any) => {
        // Skip log messages
        if (msg.type === 'log') {
          return;
        }

        // Remove the handler after receiving a response
        this.workerEvaluator!.off('message', messageHandler);

        if (!msg || typeof msg !== 'object' ||
          !msg.id ||
          msg.type !== 'complete' ||
          typeof msg.success !== 'boolean' ||
          (msg.error !== null && (typeof msg.error !== 'object' || !msg.error.message)) ||
          typeof msg.output !== 'string') {
          reject(new Error('Invalid worker response format'));
          return;
        }
        if (msg.success) {
          resolve();
        } else {
          reject(new Error(msg.error?.message || 'Unknown error'));
        }
      };

      this.workerEvaluator!.on('message', messageHandler);
      this.workerEvaluator!.on('error', (error: Error) => {
        this.workerEvaluator!.off('message', messageHandler);
        reject(new Error(`Worker error: ${error.message}`));
      });
    });
  }

  /**
   * Cleans up resources (e.g., terminates the worker).
   */
  async destroy(): Promise<void> {
    if (!this.workerEvaluator) {
      return;
    }

    try {
      // First terminate the worker
      await this.workerEvaluator.terminate();
      this.workerEvaluator = null;

      // Then handle WASM cleanup
      if (this.instance) {
        const exports = this.instance.exports;

        // Only proceed with memory cleanup if we have a valid memory instance
        if (exports.memory) {
          try {
            // Run garbage collection if available
            if (typeof exports.__collect === 'function') {
              exports.__collect();
            }

            // Unpin all pinned objects if available
            if (typeof exports.__unpin === 'function') {
              // Note: In a real implementation, you might want to track pinned objects
              // and unpin them individually. For now, we'll unpin the root.
              exports.__unpin(0);
            }

            // Clear any remaining references
            if (typeof exports.__free === 'function') {
              // Note: In a real implementation, you might want to track allocated objects
              // and free them individually. For now, we'll rely on __collect.
              exports.__free(0);
            }
          } catch (error) {
            // Log specific cleanup errors but don't throw - we want to ensure cleanup continues
            logger.error(`WASM memory cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // Clear the instance reference
        this.instance = null;
      }
    } catch (error) {
      // Log any unexpected errors during cleanup
      logger.error(`Unexpected error during WASM cleanup: ${error instanceof Error ? error.message : String(error)}`);
      throw error; // Re-throw to ensure caller knows cleanup failed
    } finally {
      // Only close standard streams in Node.js environment
      if (typeof process !== 'undefined' && process.stdout) {
        try {
          if (process.stdout) {
            process.stdout.end();
            process.stdout.destroy();
          }
          if (process.stderr) {
            process.stderr.end();
            process.stderr.destroy();
          }
        } catch (error) {
          logger.error(`Error closing standard streams: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  async terminate(): Promise<void> {
    await this.destroy();
  }

  /**
   * Cleans up all resources. Should be called after all operations are complete.
   */
  async cleanup(): Promise<void> {
    await this.destroy();
  }
}

// Export a singleton instance of WasmRunner
const wasmRunner = new WasmRunner();
export const initWasm = async (wasmSource: string | ArrayBuffer | Uint8Array) => {
  await wasmRunner.initialize(wasmSource);
  return wasmRunner;
};
export const workerEvaluator = wasmRunner;