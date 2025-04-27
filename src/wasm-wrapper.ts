import { instantiate, ASUtil } from '@assemblyscript/loader';
import { WorkerEvaluator } from './worker-evaluator.js';

// Type definitions for WASM module exports
interface MyWasmExports extends ASUtil {
  runHardcodedJSCode: () => void;
  runJSCode: (jsCodePtr: number) => void;
  embedJSCode: (jsPathPtr: number) => number;
  __newString: (str: string) => number;
  __free: (ptr: number) => void;
  [key: string]: any; // Add index signature
}

// Type for the instantiated WASM module API
export interface WasmInstance {
  runHardcodedJSCode: () => void;
  runJSCode: (jsCode: string) => void;
}

// Global instance to ensure evaluate can access exports
let instance: { exports: MyWasmExports } | null = null;
export let workerEvaluator: WorkerEvaluator | null = null;

export async function initWasm(wasmSource: string | ArrayBuffer | Uint8Array): Promise<WasmInstance> {
  // Initialize the worker evaluator
  workerEvaluator = new WorkerEvaluator();
  await workerEvaluator.initialize();

  // Define custom imports for the evaluate function
  const imports = {
    index: {
      evaluate: async (ptr: number, length: number) => {
        if (!instance) {
          throw new Error('WASM instance not initialized');
        }
        const memory = instance.exports.memory!;
        if (ptr < 0 || length < 0 || ptr + length > memory.buffer.byteLength) {
          throw new Error(`Invalid memory access: ptr=${ptr}, length=${length}`);
        }
        const rawBytes = new Uint8Array(memory.buffer, ptr, length);
        const jsCode = new TextDecoder().decode(rawBytes).trim();
        try {
          await workerEvaluator!.evaluate(jsCode);
        } catch (error) {
          console.error('Error executing JavaScript code:', error);
          throw error;
        }
      },
      __new: (size: number, id: number) => {
        return instance!.exports.__new(size, id);
      },
      __pin: (ptr: number) => {
        return instance!.exports.__pin(ptr);
      },
      __unpin: (ptr: number) => {
        return instance!.exports.__unpin(ptr);
      },
      __collect: () => {
        return instance!.exports.__collect();
      },
      memory_copy: (dest: number, src: number, n: number) => {
        const memory = instance!.exports.memory!;
        const destArray = new Uint8Array(memory.buffer, dest, n);
        const srcArray = new Uint8Array(memory.buffer, src, n);
        destArray.set(srcArray);
      },
      __free: (ptr: number) => {
        // In the incremental runtime, we don't need to do anything here
        // as the garbage collector will handle memory management
      }
    },
    env: {
      abort: (msg: number, file: number, line: number, column: number) => {
        console.error('WASM abort:', msg, file, line, column);
        throw new Error('WASM abort');
      }
    }
  };

  // Instantiate the WASM module
  try {
    if (typeof wasmSource === 'string') {
      // Browser: Fetch the WASM file
      const response = await fetch(wasmSource);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM file: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      instance = await instantiate<MyWasmExports>(buffer, imports);
    } else {
      // Node.js: Use the provided buffer
      instance = await instantiate<MyWasmExports>(wasmSource, imports);
    }
  } catch (error) {
    console.error('Error instantiating WASM module:', error);
    throw error;
  }

  // Validate required exports
  if (!instance.exports.runHardcodedJSCode || !instance.exports.runJSCode) {
    throw new Error('Required WASM exports (runHardcodedJSCode or runJSCode) are missing');
  }

  // Return a simplified API
  return {
    runHardcodedJSCode: async () => {
      const result = instance!.exports.runHardcodedJSCode();
      return new Promise<void>((resolve) => {
        workerEvaluator!.on('message', () => {
          resolve();
        });
      });
    },
    runJSCode: async (jsCode: string) => {
      const strPtr = instance!.exports.__newString(jsCode);
      const result = instance!.exports.runJSCode(strPtr);
      return new Promise<void>((resolve) => {
        workerEvaluator!.on('message', () => {
          resolve();
        });
      });
    }
  };
}

export class WasmWrapper {
  private instance: WebAssembly.Instance;
  private workerEvaluator: WorkerEvaluator;

  constructor(instance: WebAssembly.Instance, workerEvaluator: WorkerEvaluator) {
    this.instance = instance;
    this.workerEvaluator = workerEvaluator;
  }

  async runHardcodedJSCode(): Promise<void> {
    const exports = this.instance.exports as {
      runHardcodedJSCode: () => void;
    };
    exports.runHardcodedJSCode();
    return new Promise((resolve) => {
      this.workerEvaluator.on('message', () => {
        resolve();
      });
    });
  }

  async runJSCode(code: string): Promise<void> {
    const exports = this.instance.exports as {
      __newString: (str: string) => number;
      runJSCode: (ptr: number) => void;
    };
    if (!exports.__newString) {
      throw new Error('__newString not exported by WASM module');
    }
    const strPtr = exports.__newString(code);
    if (typeof strPtr !== 'number') {
      throw new Error('__newString did not return a number');
    }
    exports.runJSCode(strPtr);
    return new Promise((resolve) => {
      this.workerEvaluator.on('message', () => {
        resolve();
      });
    });
  }
}