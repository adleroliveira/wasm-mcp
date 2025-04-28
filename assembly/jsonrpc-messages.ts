import { SchemaType, ValidationResult } from "./schema-validator";
import { ValidatableParams, RequestParamsWithMeta } from "./protocol-types";
import { Request, Result } from "./schema";

/**
 * Base class for all JSON-RPC messages
 */
export abstract class JSONRPCMessageBase extends ValidatableParams {
  jsonrpc: "2.0" = "2.0";

  static defineSchema(): Map<string, SchemaType> {
    const schema = new Map<string, SchemaType>();
    schema.set("jsonrpc", SchemaType.string().makeNullable());
    return schema;
  }

  validate(): ValidationResult {
    return JSONRPCMessageBase.validate(this);
  }
}

/**
 * JSON-RPC Request message
 */
export class JSONRPCRequest extends RequestParamsWithMeta implements Request {
  jsonrpc: "2.0" = "2.0";
  id: string | number;
  method: string;
  params: {
    _meta: {
      progressToken?: string | number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };

  constructor(id: string | number, method: string, params: { [key: string]: unknown } = {}) {
    super();
    this.id = id;
    this.method = method;
    // Ensure _meta is always initialized
    this.params = {
      _meta: {},
      ...params
    };
    // Initialize the internal _meta Map
    this._meta = new Map<string, string>();
  }

  static defineSchema(): Map<string, SchemaType> {
    const schema = super.defineSchema();
    schema.set("id", SchemaType.union([
      SchemaType.string(),
      SchemaType.number()
    ]));
    schema.set("method", SchemaType.string());
    schema.set("params", SchemaType.object());
    return schema;
  }

  static create(id: string | number, method: string, params: { [key: string]: unknown } = {}): JSONRPCRequest {
    return new JSONRPCRequest(id, method, params);
  }

  /**
   * Adds metadata to the request parameters
   * @param key - The metadata key
   * @param value - The metadata value
   */
  addMetadata(key: string, value: string): void {
    this._meta.set(key, value);
    this.params._meta[key] = value;
  }

  /**
   * Gets metadata value by key
   * @param key - The metadata key
   * @returns The metadata value or null if not found
   */
  getMetadata(key: string): string | null {
    return this._meta.get(key) || null;
  }

  /**
   * Removes metadata by key
   * @param key - The metadata key to remove
   */
  removeMetadata(key: string): void {
    this._meta.delete(key);
    delete this.params._meta[key];
  }

  /**
   * Gets all metadata as a Map
   * @returns A Map containing all metadata
   */
  getAllMetadata(): Map<string, string> {
    return this._meta;
  }
}

/**
 * JSON-RPC Response message
 */
export class JSONRPCResponse extends JSONRPCMessageBase {
  id: string | number;
  result: Result;

  constructor(id: string | number, result: Result) {
    super();
    this.id = id;
    this.result = result;
  }

  static defineSchema(): Map<string, SchemaType> {
    const schema = super.defineSchema();
    schema.set("id", SchemaType.union([
      SchemaType.string(),
      SchemaType.number()
    ]));
    schema.set("result", SchemaType.object());
    return schema;
  }

  static create(id: string | number, result: Result): JSONRPCResponse | null {
    const response = new JSONRPCResponse(id, result);
    return response.validate().valid ? response : null;
  }
}

/**
 * JSON-RPC Error message
 */
export class JSONRPCError extends JSONRPCMessageBase {
  id: string | number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };

  constructor(id: string | number, code: number, message: string, data?: unknown) {
    super();
    this.id = id;
    this.error = { code, message, data };
  }

  static defineSchema(): Map<string, SchemaType> {
    const schema = super.defineSchema();
    schema.set("id", SchemaType.union([
      SchemaType.string(),
      SchemaType.number()
    ]));
    schema.set("error", SchemaType.object());
    return schema;
  }

  static create(id: string | number, code: number, message: string, data?: unknown): JSONRPCError | null {
    const error = new JSONRPCError(id, code, message, data);
    return error.validate().valid ? error : null;
  }
}

/**
 * JSON-RPC Notification message
 */
export class JSONRPCNotification extends JSONRPCMessageBase {
  method: string;
  params: { [key: string]: unknown };

  constructor(method: string, params: { [key: string]: unknown } = {}) {
    super();
    this.method = method;
    this.params = params;
  }

  static defineSchema(): Map<string, SchemaType> {
    const schema = super.defineSchema();
    schema.set("method", SchemaType.string());
    schema.set("params", SchemaType.object());
    return schema;
  }

  static create(method: string, params: { [key: string]: unknown } = {}): JSONRPCNotification | null {
    const notification = new JSONRPCNotification(method, params);
    return notification.validate().valid ? notification : null;
  }
} 