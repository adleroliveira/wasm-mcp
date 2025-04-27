// node_modules/@assemblyscript/loader/index.js
var ID_OFFSET = -8;
var SIZE_OFFSET = -4;
var ARRAYBUFFER_ID = 1;
var STRING_ID = 2;
var ARRAYBUFFERVIEW = 1 << 0;
var ARRAY = 1 << 1;
var STATICARRAY = 1 << 2;
var VAL_ALIGN_OFFSET = 6;
var VAL_SIGNED = 1 << 11;
var VAL_FLOAT = 1 << 12;
var VAL_MANAGED = 1 << 14;
var ARRAYBUFFERVIEW_BUFFER_OFFSET = 0;
var ARRAYBUFFERVIEW_DATASTART_OFFSET = 4;
var ARRAYBUFFERVIEW_BYTELENGTH_OFFSET = 8;
var ARRAYBUFFERVIEW_SIZE = 12;
var ARRAY_LENGTH_OFFSET = 12;
var ARRAY_SIZE = 16;
var E_NO_EXPORT_TABLE = "Operation requires compiling with --exportTable";
var E_NO_EXPORT_RUNTIME = "Operation requires compiling with --exportRuntime";
var F_NO_EXPORT_RUNTIME = () => {
  throw Error(E_NO_EXPORT_RUNTIME);
};
var BIGINT = typeof BigUint64Array !== "undefined";
var THIS = Symbol();
var STRING_SMALLSIZE = 192;
var STRING_CHUNKSIZE = 1024;
var utf16 = new TextDecoder("utf-16le", { fatal: true });
Object.hasOwn = Object.hasOwn || function(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
};
function getStringImpl(buffer, ptr) {
  let len = new Uint32Array(buffer)[ptr + SIZE_OFFSET >>> 2] >>> 1;
  const wtf16 = new Uint16Array(buffer, ptr, len);
  if (len <= STRING_SMALLSIZE) return String.fromCharCode(...wtf16);
  try {
    return utf16.decode(wtf16);
  } catch {
    let str = "", off = 0;
    while (len - off > STRING_CHUNKSIZE) {
      str += String.fromCharCode(...wtf16.subarray(off, off += STRING_CHUNKSIZE));
    }
    return str + String.fromCharCode(...wtf16.subarray(off));
  }
}
function preInstantiate(imports) {
  const extendedExports = {};
  function getString(memory, ptr) {
    if (!memory) return "<yet unknown>";
    return getStringImpl(memory.buffer, ptr);
  }
  const env = imports.env = imports.env || {};
  env.abort = env.abort || function abort(msg, file, line, colm) {
    const memory = extendedExports.memory || env.memory;
    throw Error(`abort: ${getString(memory, msg)} at ${getString(memory, file)}:${line}:${colm}`);
  };
  env.trace = env.trace || function trace(msg, n, ...args) {
    const memory = extendedExports.memory || env.memory;
    console.log(`trace: ${getString(memory, msg)}${n ? " " : ""}${args.slice(0, n).join(", ")}`);
  };
  env.seed = env.seed || Date.now;
  imports.Math = imports.Math || Math;
  imports.Date = imports.Date || Date;
  return extendedExports;
}
function postInstantiate(extendedExports, instance) {
  const exports = instance.exports;
  const memory = exports.memory;
  const table = exports.table;
  const __new = exports.__new || F_NO_EXPORT_RUNTIME;
  const __pin = exports.__pin || F_NO_EXPORT_RUNTIME;
  const __unpin = exports.__unpin || F_NO_EXPORT_RUNTIME;
  const __collect = exports.__collect || F_NO_EXPORT_RUNTIME;
  const __rtti_base = exports.__rtti_base;
  const getTypeinfoCount = __rtti_base ? (arr) => arr[__rtti_base >>> 2] : F_NO_EXPORT_RUNTIME;
  extendedExports.__new = __new;
  extendedExports.__pin = __pin;
  extendedExports.__unpin = __unpin;
  extendedExports.__collect = __collect;
  function getTypeinfo(id) {
    const U32 = new Uint32Array(memory.buffer);
    if ((id >>>= 0) >= getTypeinfoCount(U32)) throw Error(`invalid id: ${id}`);
    return U32[(__rtti_base + 4 >>> 2) + id];
  }
  function getArrayInfo(id) {
    const info = getTypeinfo(id);
    if (!(info & (ARRAYBUFFERVIEW | ARRAY | STATICARRAY))) throw Error(`not an array: ${id}, flags=${info}`);
    return info;
  }
  function getValueAlign(info) {
    return 31 - Math.clz32(info >>> VAL_ALIGN_OFFSET & 31);
  }
  function __newString(str) {
    if (str == null) return 0;
    const length = str.length;
    const ptr = __new(length << 1, STRING_ID);
    const U16 = new Uint16Array(memory.buffer);
    for (let i = 0, p = ptr >>> 1; i < length; ++i) U16[p + i] = str.charCodeAt(i);
    return ptr;
  }
  extendedExports.__newString = __newString;
  function __newArrayBuffer(buf) {
    if (buf == null) return 0;
    const bufview = new Uint8Array(buf);
    const ptr = __new(bufview.length, ARRAYBUFFER_ID);
    const U8 = new Uint8Array(memory.buffer);
    U8.set(bufview, ptr);
    return ptr;
  }
  extendedExports.__newArrayBuffer = __newArrayBuffer;
  function __getString(ptr) {
    if (!ptr) return null;
    const buffer = memory.buffer;
    const id = new Uint32Array(buffer)[ptr + ID_OFFSET >>> 2];
    if (id !== STRING_ID) throw Error(`not a string: ${ptr}`);
    return getStringImpl(buffer, ptr);
  }
  extendedExports.__getString = __getString;
  function getView(alignLog2, signed, float) {
    const buffer = memory.buffer;
    if (float) {
      switch (alignLog2) {
        case 2:
          return new Float32Array(buffer);
        case 3:
          return new Float64Array(buffer);
      }
    } else {
      switch (alignLog2) {
        case 0:
          return new (signed ? Int8Array : Uint8Array)(buffer);
        case 1:
          return new (signed ? Int16Array : Uint16Array)(buffer);
        case 2:
          return new (signed ? Int32Array : Uint32Array)(buffer);
        case 3:
          return new (signed ? BigInt64Array : BigUint64Array)(buffer);
      }
    }
    throw Error(`unsupported align: ${alignLog2}`);
  }
  function __newArray(id, valuesOrCapacity = 0) {
    const input = valuesOrCapacity;
    const info = getArrayInfo(id);
    const align = getValueAlign(info);
    const isArrayLike = typeof input !== "number";
    const length = isArrayLike ? input.length : input;
    const buf = __new(length << align, info & STATICARRAY ? id : ARRAYBUFFER_ID);
    let result;
    if (info & STATICARRAY) {
      result = buf;
    } else {
      __pin(buf);
      const arr = __new(info & ARRAY ? ARRAY_SIZE : ARRAYBUFFERVIEW_SIZE, id);
      __unpin(buf);
      const U32 = new Uint32Array(memory.buffer);
      U32[arr + ARRAYBUFFERVIEW_BUFFER_OFFSET >>> 2] = buf;
      U32[arr + ARRAYBUFFERVIEW_DATASTART_OFFSET >>> 2] = buf;
      U32[arr + ARRAYBUFFERVIEW_BYTELENGTH_OFFSET >>> 2] = length << align;
      if (info & ARRAY) U32[arr + ARRAY_LENGTH_OFFSET >>> 2] = length;
      result = arr;
    }
    if (isArrayLike) {
      const view = getView(align, info & VAL_SIGNED, info & VAL_FLOAT);
      const start = buf >>> align;
      if (info & VAL_MANAGED) {
        for (let i = 0; i < length; ++i) {
          view[start + i] = input[i];
        }
      } else {
        view.set(input, start);
      }
    }
    return result;
  }
  extendedExports.__newArray = __newArray;
  function __getArrayView(arr) {
    const U32 = new Uint32Array(memory.buffer);
    const id = U32[arr + ID_OFFSET >>> 2];
    const info = getArrayInfo(id);
    const align = getValueAlign(info);
    let buf = info & STATICARRAY ? arr : U32[arr + ARRAYBUFFERVIEW_DATASTART_OFFSET >>> 2];
    const length = info & ARRAY ? U32[arr + ARRAY_LENGTH_OFFSET >>> 2] : U32[buf + SIZE_OFFSET >>> 2] >>> align;
    return getView(align, info & VAL_SIGNED, info & VAL_FLOAT).subarray(buf >>>= align, buf + length);
  }
  extendedExports.__getArrayView = __getArrayView;
  function __getArray(arr) {
    const input = __getArrayView(arr);
    const len = input.length;
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = input[i];
    return out;
  }
  extendedExports.__getArray = __getArray;
  function __getArrayBuffer(ptr) {
    const buffer = memory.buffer;
    const length = new Uint32Array(buffer)[ptr + SIZE_OFFSET >>> 2];
    return buffer.slice(ptr, ptr + length);
  }
  extendedExports.__getArrayBuffer = __getArrayBuffer;
  function __getFunction(ptr) {
    if (!table) throw Error(E_NO_EXPORT_TABLE);
    const index = new Uint32Array(memory.buffer)[ptr >>> 2];
    return table.get(index);
  }
  extendedExports.__getFunction = __getFunction;
  function getTypedArray(Type, alignLog2, ptr) {
    return new Type(getTypedArrayView(Type, alignLog2, ptr));
  }
  function getTypedArrayView(Type, alignLog2, ptr) {
    const buffer = memory.buffer;
    const U32 = new Uint32Array(buffer);
    return new Type(
      buffer,
      U32[ptr + ARRAYBUFFERVIEW_DATASTART_OFFSET >>> 2],
      U32[ptr + ARRAYBUFFERVIEW_BYTELENGTH_OFFSET >>> 2] >>> alignLog2
    );
  }
  function attachTypedArrayFunctions(ctor, name, align) {
    extendedExports[`__get${name}`] = getTypedArray.bind(null, ctor, align);
    extendedExports[`__get${name}View`] = getTypedArrayView.bind(null, ctor, align);
  }
  [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array
  ].forEach((ctor) => {
    attachTypedArrayFunctions(ctor, ctor.name, 31 - Math.clz32(ctor.BYTES_PER_ELEMENT));
  });
  if (BIGINT) {
    [BigUint64Array, BigInt64Array].forEach((ctor) => {
      attachTypedArrayFunctions(ctor, ctor.name.slice(3), 3);
    });
  }
  extendedExports.memory = extendedExports.memory || memory;
  extendedExports.table = extendedExports.table || table;
  return demangle(exports, extendedExports);
}
function isResponse(src) {
  return typeof Response !== "undefined" && src instanceof Response;
}
function isModule(src) {
  return src instanceof WebAssembly.Module;
}
async function instantiate(source, imports = {}) {
  if (isResponse(source = await source)) return instantiateStreaming(source, imports);
  const module = isModule(source) ? source : await WebAssembly.compile(source);
  const extended = preInstantiate(imports);
  const instance = await WebAssembly.instantiate(module, imports);
  const exports = postInstantiate(extended, instance);
  return { module, instance, exports };
}
async function instantiateStreaming(source, imports = {}) {
  if (!WebAssembly.instantiateStreaming) {
    return instantiate(
      isResponse(source = await source) ? source.arrayBuffer() : source,
      imports
    );
  }
  const extended = preInstantiate(imports);
  const result = await WebAssembly.instantiateStreaming(source, imports);
  const exports = postInstantiate(extended, result.instance);
  return { ...result, exports };
}
function demangle(exports, extendedExports = {}) {
  const setArgumentsLength = exports["__argumentsLength"] ? (length) => {
    exports["__argumentsLength"].value = length;
  } : exports["__setArgumentsLength"] || exports["__setargc"] || (() => {
  });
  for (let internalName of Object.keys(exports)) {
    const elem = exports[internalName];
    let parts = internalName.split(".");
    let curr = extendedExports;
    while (parts.length > 1) {
      let part = parts.shift();
      if (!Object.hasOwn(curr, part)) curr[part] = {};
      curr = curr[part];
    }
    let name = parts[0];
    let hash = name.indexOf("#");
    if (hash >= 0) {
      const className = name.substring(0, hash);
      const classElem = curr[className];
      if (typeof classElem === "undefined" || !classElem.prototype) {
        const ctor = function(...args) {
          return ctor.wrap(ctor.prototype.constructor(0, ...args));
        };
        ctor.prototype = {
          valueOf() {
            return this[THIS];
          }
        };
        ctor.wrap = function(thisValue) {
          return Object.create(ctor.prototype, { [THIS]: { value: thisValue, writable: false } });
        };
        if (classElem) Object.getOwnPropertyNames(classElem).forEach(
          (name2) => Object.defineProperty(ctor, name2, Object.getOwnPropertyDescriptor(classElem, name2))
        );
        curr[className] = ctor;
      }
      name = name.substring(hash + 1);
      curr = curr[className].prototype;
      if (/^(get|set):/.test(name)) {
        if (!Object.hasOwn(curr, name = name.substring(4))) {
          let getter = exports[internalName.replace("set:", "get:")];
          let setter = exports[internalName.replace("get:", "set:")];
          Object.defineProperty(curr, name, {
            get() {
              return getter(this[THIS]);
            },
            set(value) {
              setter(this[THIS], value);
            },
            enumerable: true
          });
        }
      } else {
        if (name === "constructor") {
          (curr[name] = function(...args) {
            setArgumentsLength(args.length);
            return elem(...args);
          }).original = elem;
        } else {
          (curr[name] = function(...args) {
            setArgumentsLength(args.length);
            return elem(this[THIS], ...args);
          }).original = elem;
        }
      }
    } else {
      if (/^(get|set):/.test(name)) {
        if (!Object.hasOwn(curr, name = name.substring(4))) {
          Object.defineProperty(curr, name, {
            get: exports[internalName.replace("set:", "get:")],
            set: exports[internalName.replace("get:", "set:")],
            enumerable: true
          });
        }
      } else if (typeof elem === "function" && elem !== setArgumentsLength) {
        (curr[name] = (...args) => {
          setArgumentsLength(args.length);
          return elem(...args);
        }).original = elem;
      } else {
        curr[name] = elem;
      }
    }
  }
  return extendedExports;
}

// src/logger.ts
var Logger = class {
  constructor() {
    this.level = 1 /* INFO */;
  }
  setLevel(level) {
    this.level = level;
  }
  debug(...args) {
    if (this.level <= 0 /* DEBUG */) {
      console.debug("[DEBUG]", ...args);
    }
  }
  info(...args) {
    if (this.level <= 1 /* INFO */) {
      console.info("[INFO]", ...args);
    }
  }
  warn(...args) {
    if (this.level <= 2 /* WARN */) {
      console.warn("[WARN]", ...args);
    }
  }
  error(...args) {
    if (this.level <= 3 /* ERROR */) {
      console.error("[ERROR]", ...args);
    }
  }
};
var logger = new Logger();

// src/worker-evaluator.ts
var require2;
var createRequire;
var isNode = typeof window === "undefined";
async function initializeNodeModules() {
  if (isNode) {
    const module = await import("module");
    createRequire = module.createRequire;
    require2 = createRequire(import.meta.url);
  }
}
var _WorkerEvaluator = class _WorkerEvaluator {
  constructor(sandboxConfig = {}) {
    this.worker = null;
    this.messageHandlers = [];
    this.errorHandlers = [];
    this.workerUrl = null;
    this.pendingEvaluations = /* @__PURE__ */ new Map();
    this.handlerCounter = 0;
    this.isBrowser = typeof window !== "undefined";
    this.sandboxConfig = {
      allowedModules: sandboxConfig.allowedModules || [],
      blockedModules: sandboxConfig.blockedModules || [],
      moduleProxies: sandboxConfig.moduleProxies || {},
      preambleCode: sandboxConfig.preambleCode || "",
      polyfills: sandboxConfig.polyfills || {}
    };
  }
  /**
   * Generates code for the process proxy.
   */
  generateProcessProxyCode() {
    const processProxy = this.sandboxConfig.moduleProxies?.process;
    if (!processProxy) return "";
    const properties = Object.entries(processProxy).map(([key, value]) => {
      if (typeof value === "function") {
        try {
          const result = value();
          return `${key}: function() { return ${JSON.stringify(result)}; }`;
        } catch (e) {
          return `${key}: function() { return undefined; } // Function not serializable`;
        }
      }
      return `${key}: ${JSON.stringify(value)}`;
    });
    return `
      ${this.isBrowser ? "self" : "global"}.process = {
        ${properties.join(",\n        ")}
      };
    `;
  }
  on(event, handler) {
    const handlerId = this.handlerCounter++;
    if (event === "message") {
      this.messageHandlers.push(handler);
    } else {
      this.errorHandlers.push(handler);
    }
    return handlerId;
  }
  off(event, handler) {
    if (event === "message") {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    } else {
      this.errorHandlers = this.errorHandlers.filter((h) => h !== handler);
    }
  }
  /**
   * Generates worker code with sandboxing logic.
   */
  generateWorkerCode() {
    const { allowedModules, blockedModules, moduleProxies, preambleCode, polyfills } = this.sandboxConfig;
    const processProxyCode = this.generateProcessProxyCode();
    const sandboxCode = `
      // Process proxy
      ${processProxyCode}

      // Polyfills for globals
      const polyfills = ${JSON.stringify(polyfills)};
      const globalObject = typeof self !== 'undefined' ? self : global;
      Object.assign(globalObject, polyfills);

      // Module resolution override
      const originalRequire = typeof require === 'function' ? require : null;
      const moduleProxies = ${JSON.stringify(moduleProxies)};
      const allowedModules = ${JSON.stringify(allowedModules)};
      const blockedModules = ${JSON.stringify(blockedModules)};

      function customRequire(moduleName) {
        if (blockedModules.includes(moduleName)) {
          throw new Error(\`Module "\${moduleName}" is blocked\`);
        }
        if (!allowedModules.length || allowedModules.includes(moduleName)) {
          if (moduleProxies[moduleName]) {
            return moduleProxies[moduleName];
          }
          if (originalRequire) {
            return originalRequire(moduleName);
          }
        }
        throw new Error(\`Module "\${moduleName}" is not allowed\`);
      }

      // Override require (Node.js)
      if (originalRequire) {
        global.require = customRequire;
      }

      // Override import (browser)
      if (typeof self !== 'undefined') {
        self.importScripts = function() {
          throw new Error('importScripts is disabled in sandbox');
        };
      }

      // Preamble code
      ${preambleCode}
    `;
    const workerCode = this.isBrowser ? `
        ${sandboxCode}
        self.onmessage = function(event) {
          const { id, type, code } = event.data;
          if (type !== 'evaluate') {
            self.postMessage({
              id,
              type: 'complete',
              success: false,
              error: { message: 'Invalid message type' },
              output: ''
            });
            return;
          }

          try {
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
              error: { message: error.message, stack: error.stack, name: error.name },
              output: ''
            });
          }
        };
      ` : `
        const { parentPort } = require('worker_threads');
        ${sandboxCode}
        parentPort.on('message', (message) => {
          const { id, type, code } = message;
          if (type !== 'evaluate') {
            parentPort.postMessage({
              id,
              type: 'complete',
              success: false,
              error: { message: 'Invalid message type' },
              output: ''
            });
            return;
          }

          try {
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
              error: { message: error.message, stack: error.stack, name: error.name },
              output: ''
            });
          }
        });
      `;
    return workerCode;
  }
  /**
   * Initializes the worker with sandboxed environment.
   */
  async initialize() {
    if (this.worker) {
      throw new Error("Worker already initialized");
    }
    try {
      await initializeNodeModules();
      const workerCode = this.generateWorkerCode();
      if (this.isBrowser) {
        const blob = new Blob([workerCode], { type: "application/javascript" });
        this.workerUrl = URL.createObjectURL(blob);
        this.worker = new globalThis.Worker(this.workerUrl);
      } else {
        const { Worker } = await import("worker_threads");
        this.worker = new Worker(workerCode, { eval: true });
      }
      this.setupListeners();
    } catch (error) {
      logger.error("Failed to initialize worker:", error);
      await this.terminate();
      throw new Error(`Failed to initialize worker: ${error}`);
    }
  }
  /**
   * Sets up persistent listeners.
   */
  setupListeners() {
    if (this.isBrowser) {
      this.worker.addEventListener("error", (event) => {
        logger.error("Worker error:", event);
        this.notifyErrorHandlers(new Error(`Worker error: ${event.message}`));
      });
      this.worker.addEventListener("message", (event) => {
        this.handleWorkerMessage(event.data);
      });
    } else {
      this.worker.on("error", (error) => {
        logger.error("Worker error:", error);
        this.notifyErrorHandlers(error);
      });
      this.worker.on("message", (data) => {
        this.handleWorkerMessage(data);
      });
    }
  }
  /**
   * Preprocesses code before evaluation.
   */
  preprocessCode(code) {
    let transformedCode = code;
    const importRegex = /import\s+.*?\s+from\s+['"](.*?)['"]/g;
    transformedCode = transformedCode.replace(importRegex, () => {
      throw new Error("Dynamic imports are disabled in sandbox");
    });
    return transformedCode;
  }
  /**
   * Evaluates code with callbacks.
   */
  evaluateWithCallback(code) {
    if (!this.worker) {
      throw new Error("Worker not initialized");
    }
    if (!code || typeof code !== "string") {
      throw new Error("JavaScript code must be a non-empty string");
    }
    if (code.length > 1e4) {
      throw new Error("Code exceeds maximum length of 10,000 characters");
    }
    const preprocessedCode = this.preprocessCode(code);
    const id = `${Date.now()}-${Math.random()}`;
    const message = { id, type: "evaluate", code: preprocessedCode };
    const messageHandler = (response) => {
      if (response.id === id) {
        this.off("message", messageHandler);
        const pending = this.pendingEvaluations.get(id);
        if (pending) {
          if (response.success) {
            if (response.output) {
              logger.info(response.output);
            }
            pending.resolve();
          } else {
            pending.reject(new Error(response.error?.message || "Unknown error"));
          }
          this.pendingEvaluations.delete(id);
        }
        this.notifyMessageHandlers(response);
      }
    };
    this.on("message", messageHandler);
    this.worker.postMessage(message);
    setTimeout(() => {
      if (this.pendingEvaluations.has(id)) {
        this.off("message", messageHandler);
        const pending = this.pendingEvaluations.get(id);
        if (pending) {
          pending.reject(new Error("Callback evaluation timed out"));
          this.pendingEvaluations.delete(id);
        }
      }
    }, _WorkerEvaluator.EVALUATION_TIMEOUT_MS);
  }
  /**
   * Asynchronously evaluates code.
   */
  async evaluate(code) {
    if (!this.worker) {
      throw new Error("Worker not initialized");
    }
    if (!code || typeof code !== "string") {
      throw new Error("JavaScript code must be a non-empty string");
    }
    if (code.length > 1e4) {
      throw new Error("Code exceeds maximum length of 10,000 characters");
    }
    const preprocessedCode = this.preprocessCode(code);
    const id = `${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      this.pendingEvaluations.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingEvaluations.has(id)) {
          this.pendingEvaluations.delete(id);
          reject(new Error("Worker evaluation timed out"));
        }
      }, _WorkerEvaluator.EVALUATION_TIMEOUT_MS);
      this.worker.postMessage({ id, type: "evaluate", code: preprocessedCode });
    });
  }
  /**
   * Handles worker messages.
   */
  handleWorkerMessage(data) {
    if (!data || typeof data !== "object" || !data.id || data.type !== "complete") {
      this.notifyErrorHandlers(new Error("Invalid worker response format"));
      return;
    }
    const pending = this.pendingEvaluations.get(data.id);
    if (pending) {
      if (data.success) {
        if (data.output) {
          logger.info("Worker output:", data.output);
        }
        pending.resolve();
        this.notifyMessageHandlers(data);
      } else {
        pending.reject(new Error(data.error?.message || "Unknown error"));
      }
      this.pendingEvaluations.delete(data.id);
    } else {
      this.notifyMessageHandlers(data);
    }
  }
  /**
   * Notifies message handlers.
   */
  notifyMessageHandlers(response) {
    this.messageHandlers.forEach((handler) => handler(response));
  }
  /**
   * Notifies error handlers.
   */
  notifyErrorHandlers(error) {
    this.errorHandlers.forEach((handler) => handler(error));
  }
  /**
   * Terminates the worker.
   */
  async terminate() {
    if (!this.worker) {
      return;
    }
    logger.info("Starting worker termination...");
    try {
      this.messageHandlers = [];
      this.errorHandlers = [];
      this.pendingEvaluations.clear();
      if (this.isBrowser) {
        logger.info("Terminating browser worker...");
        this.worker.terminate();
        if (this.workerUrl) {
          logger.info("Revoking worker URL...");
          URL.revokeObjectURL(this.workerUrl);
          this.workerUrl = null;
        }
      } else {
        logger.info("Terminating Node.js worker...");
        const worker = this.worker;
        await worker.terminate();
      }
    } catch (error) {
      logger.warn(`Failed to terminate worker: ${error}`);
    } finally {
      this.worker = null;
      logger.info("Worker termination complete");
    }
  }
};
_WorkerEvaluator.EVALUATION_TIMEOUT_MS = 5e3;
var WorkerEvaluator = _WorkerEvaluator;

// src/wasm-wrapper.ts
var _WasmRunner = class _WasmRunner {
  constructor() {
    this.instance = null;
    this.workerEvaluator = null;
  }
  // 1MB max JavaScript code size.
  /**
   * Initializes the WASM module and worker evaluator.
   * @param wasmSource Path to the WASM file (browser) or buffer (Node.js).
   * @throws Error if initialization fails.
   */
  async initialize(wasmSource) {
    this.workerEvaluator = new WorkerEvaluator({
      moduleProxies: {
        process: {
          cwd: () => "/mocked/cwd/path",
          platform: "mocked-platform",
          env: { NODE_ENV: "sandbox" }
        }
      }
    });
    try {
      await this.workerEvaluator.initialize();
    } catch (error) {
      throw new Error(`Failed to initialize WorkerEvaluator: ${error}`);
    }
    const imports = {
      index: {
        /**
         * Evaluates JavaScript code in the worker.
         * @param ptr Pointer to UTF-8 encoded code in WASM memory.
         * @param length Length of the code (excluding null terminator).
         */
        evaluate: (ptr, length) => {
          if (!this.instance) {
            throw new Error("WASM instance not initialized");
          }
          const memory = this.instance.exports.memory;
          if (ptr < 0 || length < 0 || ptr + length > memory.buffer.byteLength) {
            throw new Error(`Invalid memory access: ptr=${ptr}, length=${length}`);
          }
          const rawBytes = new Uint8Array(memory.buffer, ptr, length);
          const jsCode = new TextDecoder().decode(rawBytes).trim();
          this.workerEvaluator.evaluateWithCallback(jsCode);
        },
        __new: (size, id) => this.instance.exports.__new(size, id),
        __pin: (ptr) => this.instance.exports.__pin(ptr),
        __unpin: (ptr) => this.instance.exports.__unpin(ptr),
        __collect: () => this.instance.exports.__collect(),
        /**
         * Copies n bytes from src to dest in WASM memory.
         */
        memory_copy: (dest, src, n) => {
          const memory = this.instance.exports.memory;
          if (dest < 0 || src < 0 || n < 0 || dest + n > memory.buffer.byteLength || src + n > memory.buffer.byteLength) {
            throw new Error(`Invalid memory_copy: dest=${dest}, src=${src}, n=${n}`);
          }
          const destArray = new Uint8Array(memory.buffer, dest, n);
          const srcArray = new Uint8Array(memory.buffer, src, n);
          destArray.set(srcArray);
        },
        __free: (ptr) => {
        }
      },
      env: {
        /**
         * Handles WASM runtime aborts.
         */
        abort: (msg, file, line, column) => {
          throw new Error(`WASM abort at ${file}:${line}:${column}, message=${msg}`);
        }
      }
    };
    try {
      if (typeof wasmSource === "string") {
        const response = await fetch(wasmSource);
        if (!response.ok) {
          throw new Error(`Failed to fetch WASM file: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        this.instance = await instantiate(buffer, imports);
      } else {
        if (!(wasmSource instanceof ArrayBuffer) && !(wasmSource instanceof Uint8Array)) {
          throw new Error("Invalid wasmSource: must be string, ArrayBuffer, or Uint8Array");
        }
        this.instance = await instantiate(wasmSource, imports);
      }
    } catch (error) {
      await this.destroy();
      throw new Error(`Failed to instantiate WASM module: ${error}`);
    }
    if (!this.instance.exports.run || !this.instance.exports.runJSCode || !this.instance.exports.__newString) {
      await this.destroy();
      throw new Error("Required WASM exports (run, runJSCode, __newString) are missing");
    }
  }
  /**
   * Runs the WASM module's default JavaScript code.
   * @throws Error if the WASM module or worker fails.
   */
  async run() {
    if (!this.instance || !this.workerEvaluator) {
      throw new Error("WASMRunner not initialized");
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
  async runJSCode(jsCode) {
    if (!this.instance || !this.workerEvaluator) {
      throw new Error("WASMRunner not initialized");
    }
    if (!jsCode) {
      throw new Error("JavaScript code cannot be empty");
    }
    if (jsCode.length > _WasmRunner.MAX_JS_CODE_SIZE) {
      throw new Error(`JavaScript code exceeds maximum size of ${_WasmRunner.MAX_JS_CODE_SIZE} bytes`);
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
  async waitForWorkerCompletion() {
    return new Promise((resolve, reject) => {
      const messageHandler = (msg) => {
        if (msg.type === "log") {
          return;
        }
        this.workerEvaluator.off("message", messageHandler);
        if (!msg || typeof msg !== "object" || !msg.id || msg.type !== "complete" || typeof msg.success !== "boolean" || msg.error !== null && (typeof msg.error !== "object" || !msg.error.message) || typeof msg.output !== "string") {
          reject(new Error("Invalid worker response format"));
          return;
        }
        if (msg.success) {
          resolve();
        } else {
          reject(new Error(msg.error?.message || "Unknown error"));
        }
      };
      this.workerEvaluator.on("message", messageHandler);
      this.workerEvaluator.on("error", (error) => {
        this.workerEvaluator.off("message", messageHandler);
        reject(new Error(`Worker error: ${error.message}`));
      });
    });
  }
  /**
   * Cleans up resources (e.g., terminates the worker).
   */
  async destroy() {
    if (!this.workerEvaluator) {
      return;
    }
    try {
      await this.workerEvaluator.terminate();
      this.workerEvaluator = null;
      if (this.instance) {
        const exports = this.instance.exports;
        if (exports.memory) {
          try {
            if (typeof exports.__collect === "function") {
              exports.__collect();
            }
            if (typeof exports.__unpin === "function") {
              exports.__unpin(0);
            }
            if (typeof exports.__free === "function") {
              exports.__free(0);
            }
          } catch (error) {
            logger.error(`WASM memory cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        this.instance = null;
      }
    } catch (error) {
      logger.error(`Unexpected error during WASM cleanup: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      if (typeof process !== "undefined" && process.stdout) {
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
  async terminate() {
    await this.destroy();
  }
  /**
   * Cleans up all resources. Should be called after all operations are complete.
   */
  async cleanup() {
    await this.destroy();
  }
};
_WasmRunner.MAX_JS_CODE_SIZE = 1024 * 1024;
var WasmRunner = _WasmRunner;
var wasmRunner = new WasmRunner();
var initWasm = async (wasmSource) => {
  await wasmRunner.initialize(wasmSource);
  return wasmRunner;
};
export {
  WorkerEvaluator,
  initWasm,
  logger
};
