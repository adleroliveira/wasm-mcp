import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Read the WASM file
  const wasmPath = path.join(__dirname, '../../build/debug.wasm');
  console.log('Loading WASM file from:', wasmPath);
  const wasmBuffer = fs.readFileSync(wasmPath);

  // Create the import object with the JSRuntime implementation
  const importObject = {
    env: {
      // Required by AssemblyScript
      abort: (msg: number, file: number, line: number, column: number) => {
        console.error('Abort called from WASM');
        throw new Error('WASM abort');
      }
    },
    index: {
      // AssemblyScript runtime functions
      __new: (size: number, id: number) => {
        const ptr = (instance.exports as any).__new(size, id);
        return ptr;
      },
      __pin: (ptr: number) => {
        return (instance.exports as any).__pin(ptr);
      },
      __unpin: (ptr: number) => {
        return (instance.exports as any).__unpin(ptr);
      },
      __collect: () => {
        return (instance.exports as any).__collect();
      },
      // Memory management functions
      memory_copy: (dest: number, src: number, n: number) => {
        const memory = (instance.exports.memory as WebAssembly.Memory).buffer;
        const destArray = new Uint8Array(memory, dest, n);
        const srcArray = new Uint8Array(memory, src, n);
        destArray.set(srcArray);
      },
      __free: (ptr: number) => {
        // In this simple case, we don't need to do anything
        // as the memory is managed by the WASM module
      },
      // JSRuntime function
      evaluate: (ptr: number, length: number) => {
        const memory = (instance.exports.memory as WebAssembly.Memory).buffer;
        const rawBytes = new Uint8Array(memory, ptr, length);
        // Find the actual end of the string (before any null terminators)
        let actualLength = length;
        while (actualLength > 0 && rawBytes[actualLength - 1] === 0) {
          actualLength--;
        }

        const jsCode = new TextDecoder().decode(rawBytes.slice(0, actualLength)).trim();
        console.log('Decoded string:', jsCode);

        try {
          // Use Function constructor instead of eval for better isolation
          const fn = new Function(jsCode);
          fn();
        } catch (error) {
          console.error('Error executing JavaScript code:', error);
          throw error;
        }
      }
    }
  };

  // Instantiate the WASM module
  const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
  // Run the JavaScript code
  console.log('Running WASM module...');
  if (typeof instance.exports.runJSCode !== 'function') {
    throw new Error('runJSCode function not found in WASM exports');
  }
  instance.exports.runJSCode();
  console.log('Done!');
}

main().catch(console.error); 