import { initWasm } from './wasm-wrapper.js';
import * as fs from 'fs';

async function main() {
  const wasmBuffer = fs.readFileSync('build/debug.wasm');
  const wasm = await initWasm(wasmBuffer);

  try {
    await wasm.run();
    await wasm.runJSCode("console.log('Dynamic code!');");
  } finally {
    await wasm.cleanup();
    process.exit(0);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});  