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
function postInstantiate(extendedExports, instance2) {
  const exports = instance2.exports;
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
  const instance2 = await WebAssembly.instantiate(module, imports);
  const exports = postInstantiate(extended, instance2);
  return { module, instance: instance2, exports };
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

// src/worker-evaluator.ts
var WorkerEvaluator = class {
  constructor() {
    this.worker = null;
    this.messageHandlers = /* @__PURE__ */ new Set();
    this.isBrowser = typeof window !== "undefined";
  }
  on(event, handler) {
    this.messageHandlers.add(handler);
  }
  notifyMessageHandlers() {
    this.messageHandlers.forEach((handler) => handler());
  }
  async initialize() {
    if (this.isBrowser) {
      const workerCode = `
        onmessage = (event) => {
          const { type, code } = event.data;
          if (type === 'evaluate') {
            try {
              const fn = new Function(code);
              fn();
              postMessage({ success: true, error: null });
            } catch (error) {
              postMessage({ success: false, error: error.message });
            }
          }
        };
      `;
      const blob = new Blob([workerCode], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new globalThis.Worker(workerUrl);
    } else {
      const { Worker } = await import("worker_threads");
      const workerPath = new URL("./worker-code.js", import.meta.url).pathname.replace("src/", "dist/");
      try {
        this.worker = new Worker(workerPath);
      } catch (error) {
        console.error("Failed to create worker:", error);
        throw error;
      }
    }
  }
  async evaluate(code) {
    if (!this.worker) {
      console.log("Worker not initialized, initializing now...");
      await this.initialize();
    }
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const messageHandler = (event) => {
        let response;
        if (this.isBrowser) {
          response = event.data;
        } else {
          response = event;
        }
        if (!response || typeof response !== "object") {
          console.error("Invalid response format:", response);
          console.error("Event structure:", event);
          reject(new Error("Invalid worker response format"));
          return;
        }
        if (this.isBrowser) {
          this.worker.removeEventListener("message", messageHandler);
        } else {
          this.worker.removeListener("message", messageHandler);
        }
        this.notifyMessageHandlers();
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error || "Unknown error"));
        }
      };
      if (this.isBrowser) {
        this.worker.addEventListener("message", messageHandler);
      } else {
        this.worker.on("message", messageHandler);
      }
      this.worker.postMessage({ type: "evaluate", code });
    });
  }
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
};

// src/wasm-wrapper.ts
var instance = null;
var workerEvaluator = null;
async function initWasm(wasmSource) {
  workerEvaluator = new WorkerEvaluator();
  await workerEvaluator.initialize();
  const imports = {
    index: {
      evaluate: async (ptr, length) => {
        if (!instance) {
          throw new Error("WASM instance not initialized");
        }
        const memory = instance.exports.memory;
        if (ptr < 0 || length < 0 || ptr + length > memory.buffer.byteLength) {
          throw new Error(`Invalid memory access: ptr=${ptr}, length=${length}`);
        }
        const rawBytes = new Uint8Array(memory.buffer, ptr, length);
        const jsCode = new TextDecoder().decode(rawBytes).trim();
        try {
          await workerEvaluator.evaluate(jsCode);
        } catch (error) {
          console.error("Error executing JavaScript code:", error);
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
      }
    },
    env: {
      abort: (msg, file, line, column) => {
        console.error("WASM abort:", msg, file, line, column);
        throw new Error("WASM abort");
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
      instance = await instantiate(buffer, imports);
    } else {
      instance = await instantiate(wasmSource, imports);
    }
  } catch (error) {
    console.error("Error instantiating WASM module:", error);
    throw error;
  }
  if (!instance.exports.runHardcodedJSCode || !instance.exports.runJSCode) {
    throw new Error("Required WASM exports (runHardcodedJSCode or runJSCode) are missing");
  }
  return {
    runHardcodedJSCode: async () => {
      const result = instance.exports.runHardcodedJSCode();
      return new Promise((resolve) => {
        workerEvaluator.on("message", () => {
          resolve();
        });
      });
    },
    runJSCode: async (jsCode) => {
      const strPtr = instance.exports.__newString(jsCode);
      const result = instance.exports.runJSCode(strPtr);
      return new Promise((resolve) => {
        workerEvaluator.on("message", () => {
          resolve();
        });
      });
    }
  };
}
export {
  WorkerEvaluator,
  initWasm
};
