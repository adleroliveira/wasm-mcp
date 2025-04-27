import { initWasm, workerEvaluator } from './wasm-wrapper.js';
import * as fs from 'fs';

async function main() {
  const wasmBuffer = fs.readFileSync('build/debug.wasm');
  const wasm = await initWasm(wasmBuffer);

  // Wait for each operation to complete
  await Promise.all([
    wasm.run(), // Outputs: Hello from WASM!
    wasm.runJSCode("console.log('Dynamic code!');") // Outputs: Dynamic code!
  ]);

  // Clean up
  if (workerEvaluator) {
    workerEvaluator.terminate();
  }
}

main().catch(console.error);  