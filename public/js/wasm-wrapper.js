import { instantiate } from '@assemblyscript/loader';
import { WorkerEvaluator } from './worker-evaluator.js';
// Global instance to ensure evaluate can access exports
let instance = null;
export let workerEvaluator = null;
export async function initWasm(wasmSource) {
    // Initialize the worker evaluator
    workerEvaluator = new WorkerEvaluator();
    await workerEvaluator.initialize();
    // Define custom imports for the evaluate function
    const imports = {
        index: {
            evaluate: async (ptr, length) => {
                if (!instance) {
                    throw new Error('WASM instance not initialized');
                }
                const memory = instance.exports.memory;
                if (ptr < 0 || length < 0 || ptr + length > memory.buffer.byteLength) {
                    throw new Error(`Invalid memory access: ptr=${ptr}, length=${length}`);
                }
                const rawBytes = new Uint8Array(memory.buffer, ptr, length);
                const jsCode = new TextDecoder().decode(rawBytes).trim();
                try {
                    await workerEvaluator.evaluate(jsCode);
                }
                catch (error) {
                    console.error('Error executing JavaScript code:', error);
                    throw error;
                }
            },
            __new: (size, id) => {
                return instance.exports.__new(size, id);
            },
            __pin: (ptr) => {
                return instance.exports.__pin(ptr);
            },
            __unpin: (ptr) => {
                return instance.exports.__unpin(ptr);
            },
            __collect: () => {
                return instance.exports.__collect();
            },
            memory_copy: (dest, src, n) => {
                const memory = instance.exports.memory;
                const destArray = new Uint8Array(memory.buffer, dest, n);
                const srcArray = new Uint8Array(memory.buffer, src, n);
                destArray.set(srcArray);
            },
            __free: (ptr) => {
                // In the incremental runtime, we don't need to do anything here
                // as the garbage collector will handle memory management
            }
        },
        env: {
            abort: (msg, file, line, column) => {
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
            instance = await instantiate(buffer, imports);
        }
        else {
            // Node.js: Use the provided buffer
            instance = await instantiate(wasmSource, imports);
        }
    }
    catch (error) {
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
            const result = instance.exports.runHardcodedJSCode();
            return new Promise((resolve) => {
                workerEvaluator.on('message', () => {
                    resolve();
                });
            });
        },
        runJSCode: async (jsCode) => {
            const strPtr = instance.exports.__newString(jsCode);
            const result = instance.exports.runJSCode(strPtr);
            return new Promise((resolve) => {
                workerEvaluator.on('message', () => {
                    resolve();
                });
            });
        }
    };
}
export class WasmWrapper {
    constructor(instance, workerEvaluator) {
        this.instance = instance;
        this.workerEvaluator = workerEvaluator;
    }
    async runHardcodedJSCode() {
        const exports = this.instance.exports;
        exports.runHardcodedJSCode();
        return new Promise((resolve) => {
            this.workerEvaluator.on('message', () => {
                resolve();
            });
        });
    }
    async runJSCode(code) {
        const exports = this.instance.exports;
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
//# sourceMappingURL=wasm-wrapper.js.map