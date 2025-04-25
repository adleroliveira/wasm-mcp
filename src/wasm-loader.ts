export async function loadWasmModule(): Promise<WebAssembly.Module> {
  const response = await fetch('build/release.wasm');
  const buffer = await response.arrayBuffer();
  return WebAssembly.compile(buffer);
} 