// Runtime declarations for WebAssembly and host environment interaction.

/** Aborts execution with an error message. Provided by the AssemblyScript runtime. */
declare function abort(message: usize, fileName: usize, line: u32, column: u32): void;

/** Frees allocated memory. Provided by the AssemblyScript runtime. */
declare function __free(ptr: usize): void;

/** Allocates memory of the specified size with the given id. Returns a pointer. */
declare function __new(size: usize, id: u32): usize;

/** Copies n bytes from src to dest in WASM memory. */
declare function memory_copy(dest: usize, src: usize, n: usize): void;

/**
 * Evaluates JavaScript code in the host environment (e.g., Web Worker or Node.js Worker Thread).
 * @param jsCodePtr Pointer to the UTF-8 encoded JavaScript code in WASM memory.
 * @param length Length of the code (excluding null terminator).
 */
declare function evaluate(jsCodePtr: usize, length: i32): void;

// Constants for memory management and safety.
const MEMORY_ID_STRING: u32 = 1; // Memory allocation ID for strings.
const NULL_TERMINATOR_SIZE: i32 = 1; // Size of null terminator in UTF-8 encoded strings.
const MAX_JS_CODE_SIZE: i32 = 1024 * 1024; // 1MB max JavaScript code size to prevent overflow.

// Hardcoded JavaScript code for testing.
const HARDCODED_JS_CODE: string = "console.log('Hello from WASM!');";

/**
 * Executes JavaScript code by encoding it to UTF-8, allocating WASM memory, and passing it to the host's evaluate function.
 * @param jsCode The JavaScript code to execute. If null, uses hardcoded test code.
 * @throws Error if memory allocation fails, input is invalid, or evaluation fails.
 */
export function runJSCode(jsCode: string | null = null): void {
  // Use hardcoded code if none provided.
  const code = jsCode !== null ? jsCode : HARDCODED_JS_CODE;

  // Validate input.
  if (code.length === 0) {
    throw new Error("JavaScript code cannot be empty.");
  }
  if (code.length > MAX_JS_CODE_SIZE) {
    throw new Error(`JavaScript code exceeds maximum size of ${MAX_JS_CODE_SIZE} bytes.`);
  }

  // Encode to UTF-8 with null terminator.
  const buffer = String.UTF8.encode(code, true);
  if (buffer.byteLength === 0) {
    throw new Error("Failed to encode JavaScript code to UTF-8.");
  }

  // Allocate memory.
  const ptr = __new(buffer.byteLength, MEMORY_ID_STRING);
  if (ptr === 0) {
    throw new Error("Memory allocation failed.");
  }

  // Copy buffer to WASM memory and evaluate.
  memory_copy(ptr, changetype<usize>(buffer), buffer.byteLength);
  evaluate(ptr, <i32>(buffer.byteLength - NULL_TERMINATOR_SIZE));
  // Free memory after evaluation
  __free(ptr);
}

/**
 * Placeholder for embedding JavaScript code at compile time.
 * Intended to be replaced by a build-time process that injects JavaScript code as a string.
 * @param jsPath Path to the JavaScript file (used during compilation).
 * @returns The embedded JavaScript code (post-compilation).
 * @throws Error indicating this is a placeholder.
 */
export function embedJSCode(jsPath: string): string {
  throw new Error(
    "embedJSCode is a placeholder. Replace with compiled JavaScript code during build process."
  );
}

/**
 * Default function to run the embedded JavaScript code.
 * This is the main entry point that will execute the code embedded at compile time.
 * @returns void
 */
export function run(): void {
  runJSCode(null);
}