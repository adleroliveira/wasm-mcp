import { RequestId, Result, ErrorCode, Progress, Request, Notification } from "./schema";
import { JSONRPCNotification } from "./jsonrpc-messages";
import { AbortSignal } from "./types";
import { AuthInfo } from "./transport";
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from "./constants";
import { SchemaType, SchemaValidator, ValidationResult } from "./schema-validator";
import { JSONRPCRequest } from "./jsonrpc-messages";

// Forward declaration of Protocol to avoid circular dependency
export interface IProtocol {
  notification(notification: JSONRPCNotification, options: NotificationOptions | null): void;
  request(request: JSONRPCRequest, options: RequestOptions | null, callback: RequestCallback): void;
}

/**
 * Base class for parameter types that can be validated against a schema
 */
export class ValidatableParams {
  private static _schema: Map<string, SchemaType> | null = null;
  private static _validator: SchemaValidator | null = null;

  /**
   * Get the schema definition for this parameter type
   */
  static getSchema(): Map<string, SchemaType> {
    if (!this._schema) {
      this._schema = this.defineSchema();
    }
    return this._schema!;
  }

  /**
   * Get the validator instance for this parameter type
   */
  static getValidator(): SchemaValidator {
    if (!this._validator) {
      this._validator = new SchemaValidator(this.getSchema());
    }
    return this._validator!;
  }

  /**
   * Define the schema for this parameter type
   * Must be implemented by subclasses
   */
  static defineSchema(): Map<string, SchemaType> {
    throw new Error("defineSchema must be implemented by subclasses");
  }

  /**
   * Validate an object against this parameter type's schema
   */
  static validate(obj: unknown): ValidationResult {
    return this.getValidator().validate(obj);
  }

  /**
   * Extract and validate parameters from an object
   */
  static extract<T extends ValidatableParams>(obj: unknown): T | null {
    const result = this.validate(obj);
    if (!result.valid) {
      return null;
    }
    return obj as T;
  }

  /**
   * Validate this instance against its schema
   */
  validate(): ValidationResult {
    return ValidatableParams.validate(this);
  }

  /**
   * Check if this instance is valid according to its schema
   */
  isValid(): boolean {
    return this.validate().valid;
  }
}

/**
 * Request parameters that include metadata
 */
export class RequestParamsWithMeta extends ValidatableParams {
  _meta: Map<string, string> = new Map<string, string>();
  [key: string]: any;

  static defineSchema(): Map<string, SchemaType> {
    const schema = new Map<string, SchemaType>();
    const metaSchema = new Map<string, SchemaType>();
    metaSchema.set("_meta", SchemaType.object(new Map<string, SchemaType>()));
    return metaSchema;
  }

  /**
   * Add metadata to the request parameters
   */
  addMeta(key: string, value: string): void {
    this._meta.set(key, value);
  }

  /**
   * Get metadata from the request parameters
   */
  getMeta(key: string): string | null {
    return this._meta.has(key) ? this._meta.get(key) : null;
  }

  /**
   * Remove metadata from the request parameters
   */
  removeMeta(key: string): void {
    this._meta.delete(key);
  }
}

/**
 * Parameter types for progress notifications
 */
export class ProgressNotificationParams extends ValidatableParams {
  progressToken: string | i32 | null = null;
  progress: number = 0;
  total: number | null = null;
  message: string | null = null;

  static defineSchema(): Map<string, SchemaType> {
    const schema = new Map<string, SchemaType>();

    // Define schema for progress token
    const progressTokenSchema = SchemaType.union([
      SchemaType.string(),
      SchemaType.number(),
      SchemaType.custom((v) => v === null)
    ]);
    schema.set("progressToken", progressTokenSchema);

    // Define schema for progress
    schema.set("progress", SchemaType.number());

    // Define schema for total
    const totalSchema = SchemaType.union([
      SchemaType.number(),
      SchemaType.custom((v) => v === null)
    ]);
    schema.set("total", totalSchema);

    // Define schema for message
    const messageSchema = SchemaType.union([
      SchemaType.string(),
      SchemaType.custom((v) => v === null)
    ]);
    schema.set("message", messageSchema);

    return schema;
  }

  /**
   * Create a new progress notification with the given values
   */
  static create(
    progressToken: string | i32 | null,
    progress: number,
    total: number | null = null,
    message: string | null = null
  ): ProgressNotificationParams {
    const params = new ProgressNotificationParams();
    params.progressToken = progressToken;
    params.progress = progress;
    params.total = total;
    params.message = message;
    return params;
  }

  /**
   * Check if the progress is complete
   */
  isComplete(): boolean {
    return this.total !== null && this.progress >= this.total;
  }

  /**
   * Get the progress percentage (0-100)
   */
  getPercentage(): number {
    if (this.total === null || this.total === 0) {
      return 0;
    }
    return (this.progress / this.total) * 100;
  }
}

/**
 * Parameter types for cancelled notifications
 */
export class CancelledNotificationParams extends ValidatableParams {
  requestId: RequestId | null = null;
  reason: string | null = null;

  static defineSchema(): Map<string, SchemaType> {
    const schema = new Map<string, SchemaType>();

    // Define schema for request ID
    const requestIdSchema = SchemaType.union([
      SchemaType.string(),
      SchemaType.number(),
      SchemaType.custom((v) => v === null)
    ]);
    schema.set("requestId", requestIdSchema);

    // Define schema for reason
    const reasonSchema = SchemaType.union([
      SchemaType.string(),
      SchemaType.custom((v) => v === null)
    ]);
    schema.set("reason", reasonSchema);

    return schema;
  }

  /**
   * Create a new cancellation notification with the given values
   */
  static create(
    requestId: RequestId | null = null,
    reason: string | null = null
  ): CancelledNotificationParams {
    const params = new CancelledNotificationParams();
    params.requestId = requestId;
    params.reason = reason;
    return params;
  }

  /**
   * Check if the cancellation has a reason
   */
  hasReason(): boolean {
    return this.reason !== null;
  }

  /**
   * Check if the cancellation is for a specific request
   */
  isForRequest(requestId: RequestId): boolean {
    return this.requestId !== null && this.requestId === requestId;
  }
}

/**
 * Error class with error codes for MCP
 * @extends Error
 */
export class McpError extends Error {
  code: ErrorCode;
  data: Map<string, string> | null;

  /**
   * Creates a new McpError instance
   * @param code - The error code
   * @param message - The error message
   * @param data - Optional additional error data
   */
  constructor(code: ErrorCode, message: string, data: Map<string, string> | null = null) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/**
 * Callback interface for request handling
 */
export interface RequestCallback {
  /**
   * Callback function for handling request results
   * @param result - The result of the request, or null if there was an error
   * @param error - The error object if the request failed, or null if successful
   */
  (result: Result | null, error: Error | null): void;
}

/**
 * Callback for progress notifications
 * @param progress - The progress information
 */
export type ProgressCallback = (progress: Progress) => void;

/**
 * Additional initialization options for the Protocol class
 */
export class ProtocolOptions {
  /**
   * Whether to restrict emitted requests to only those that the remote side has indicated that they can handle
   */
  enforceStrictCapabilities: boolean = false;
}

/**
 * Options that can be given per request
 */
export class RequestOptions {
  /**
   * Callback for progress notifications
   */
  onprogress: ProgressCallback | null = null;
  /**
   * AbortSignal for request cancellation
   */
  signal: AbortSignal | null = null;
  /**
   * Request timeout in milliseconds
   */
  timeout: i32 = DEFAULT_REQUEST_TIMEOUT_MSEC;
  /**
   * Whether to reset timeout on progress notifications
   */
  resetTimeoutOnProgress: boolean = false;
  /**
   * Maximum total timeout in milliseconds
   */
  maxTotalTimeout: i32 = 0;
  /**
   * ID of a related request
   */
  relatedRequestId: RequestId | null = null;
}

/**
 * Options that can be given per notification
 */
export class NotificationOptions {
  /**
   * ID of a related request
   */
  relatedRequestId: RequestId | null = null;
}

/**
 * Extra data given to request handlers
 */
export class RequestHandlerExtra {
  /**
   * AbortSignal for request cancellation
   */
  signal: AbortSignal;
  /**
   * Authentication information
   */
  authInfo: AuthInfo | null = null;
  /**
   * Session ID
   */
  sessionId: string | null = null;
  /**
   * Additional metadata
   */
  _meta: Map<string, string> | null = null;
  /**
   * Request ID
   */
  requestId: RequestId;
  private _protocol: IProtocol | null = null;

  /**
   * Creates a new RequestHandlerExtra instance
   * @param requestId - The request ID
   * @param signal - The AbortSignal for cancellation
   */
  constructor(requestId: RequestId, signal: AbortSignal) {
    this.requestId = requestId;
    this.signal = signal;
  }

  /**
   * Sends a notification
   * @param notification - The notification to send
   */
  sendNotification(notification: Notification): void {
    if (this._protocol) {
      const options = new NotificationOptions();
      options.relatedRequestId = this.requestId;
      const jsonrpcNotification = JSONRPCNotification.create(notification.method, notification.params);
      if (!jsonrpcNotification) {
        throw new Error("Failed to create JSON-RPC notification");
      }
      this._protocol.notification(jsonrpcNotification, options);
    } else {
      throw new Error("Protocol instance not available for sendNotification");
    }
  }

  /**
   * Sends a request
   * @param request - The request to send
   * @param options - Optional request options
   * @param callback - Callback for handling the response
   */
  sendRequest(
    request: Request,
    options: RequestOptions | null = null,
    callback: RequestCallback
  ): void {
    if (!this._protocol) {
      callback(null, new Error("Protocol instance not available"));
      return;
    }
    const fullOptions = new RequestOptions();
    if (options) {
      fullOptions.onprogress = options.onprogress;
      fullOptions.signal = options.signal;
      fullOptions.timeout = options.timeout;
      fullOptions.resetTimeoutOnProgress = options.resetTimeoutOnProgress;
      fullOptions.maxTotalTimeout = options.maxTotalTimeout;
    }
    fullOptions.relatedRequestId = this.requestId;
    const jsonrpcRequest = JSONRPCRequest.create(this.requestId, request.method, request.params);
    if (!jsonrpcRequest) {
      callback(null, new Error("Failed to create JSON-RPC request"));
      return;
    }
    this._protocol.request(jsonrpcRequest, fullOptions, callback);
  }

  /**
   * Internal method to set the protocol instance
   * @param protocol - The protocol instance
   */
  _setProtocol(protocol: IProtocol): void {
    this._protocol = protocol;
  }
}

/**
 * Information about a request's timeout state
 */
export class TimeoutInfo {
  /**
   * Timeout ID
   */
  timeoutId: i32;
  /**
   * Start time of the timeout
   */
  startTime: i32;
  /**
   * Timeout duration in milliseconds
   */
  timeout: i32;
  /**
   * Maximum total timeout in milliseconds
   */
  maxTotalTimeout: i32;
  /**
   * Whether to reset timeout on progress
   */
  resetTimeoutOnProgress: boolean;
  /**
   * Callback to execute on timeout
   */
  onTimeout: () => void;

  /**
   * Creates a new TimeoutInfo instance
   * @param timeoutId - The timeout ID
   * @param startTime - The start time
   * @param timeout - The timeout duration
   * @param maxTotalTimeout - The maximum total timeout
   * @param resetTimeoutOnProgress - Whether to reset timeout on progress
   * @param onTimeout - The timeout callback
   */
  constructor(
    timeoutId: i32,
    startTime: i32,
    timeout: i32,
    maxTotalTimeout: i32,
    resetTimeoutOnProgress: boolean,
    onTimeout: () => void
  ) {
    this.timeoutId = timeoutId;
    this.startTime = startTime;
    this.timeout = timeout;
    this.maxTotalTimeout = maxTotalTimeout;
    this.resetTimeoutOnProgress = resetTimeoutOnProgress;
    this.onTimeout = onTimeout;
  }
} 