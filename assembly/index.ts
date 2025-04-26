// Declare AssemblyScript runtime functions
declare function __free(ptr: usize): void;
declare function __new(size: usize, id: u32): usize;
declare function memory_copy(dest: usize, src: usize, n: usize): void;

// Declare the JavaScript runtime function
declare function evaluate(jsCodePtr: usize, length: i32): void;

// Function to run JavaScript code
export function runJSCode(): void {
  // Hardcoded Hello World JavaScript code
  const jsCode = "console.log('Hello from WASM!');\n";

  // Convert string to bytes and allocate memory
  const buffer = String.UTF8.encode(jsCode, true);
  const ptr = __new(buffer.byteLength, 1);

  // Copy the bytes to the allocated memory
  memory_copy(ptr, changetype<usize>(buffer), buffer.byteLength);

  // Run the JavaScript code - pass the exact length without null terminator
  evaluate(ptr, buffer.byteLength - 1);

  // Free the allocated memory
  __free(ptr);
}

// Exported function to embed JavaScript code (placeholder for compilation)
export function embedJSCode(jsPath: string): string {
  throw new Error("embedJSCode is a placeholder and should be replaced during compilation.");
  return "";
}