import { Transport, AuthInfo } from "./transport";
import {
  Request,
  Notification,
  Result,
  RequestId,
  Progress,
  JSONRPCMessage,
  ErrorCode
} from "./schema";
import { JSONRPCRequest, JSONRPCResponse, JSONRPCError, JSONRPCNotification } from "./jsonrpc-messages";
import {
  createTimeoutError,
  createCancelledNotification,
  cleanupRequest,
  setupDefaultHandlers,
  sendError,
  sendResult,
  sendNotification,
  sendJsonRpcMessage,
} from "./protocol-helpers";
import {
  ProgressNotificationParams,
  CancelledNotificationParams,
  RequestParamsWithMeta,
  McpError,
  RequestCallback,
  ProgressCallback,
  ProtocolOptions,
  RequestOptions,
  NotificationOptions,
  RequestHandlerExtra,
  TimeoutInfo,
  IProtocol
} from "./protocol-types";
import { Timer } from "./timer";
import { AbortController } from "./types";
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from "./constants";

/**
 * Implements MCP protocol framing on top of a pluggable transport, including
 * features like request/response linking, notifications, and progress.
 * @abstract
 */
export abstract class Protocol implements IProtocol {
  private _transport: Transport | null = null;
  private _requestMessageId: i32 = 0;
  private _requestHandlers: Map<string, (request: JSONRPCRequest, extra: RequestHandlerExtra) => Result> = new Map();
  private _requestHandlerAbortControllers: Map<RequestId, AbortController> = new Map();
  private _notificationHandlers: Map<string, (notification: JSONRPCNotification) => void> = new Map();
  private _responseHandlers: Map<i32, RequestCallback> = new Map();
  private _progressHandlers: Map<i32, ProgressCallback> = new Map();
  private _timeoutInfo: Map<i32, TimeoutInfo> = new Map();
  private _options: ProtocolOptions | null = null;

  /**
   * Callback for connection close events
   */
  onclose: (() => void) | null = null;
  /**
   * Callback for error events
   */
  onerror: ((error: Error) => void) | null = null;
  /**
   * Fallback request handler
   */
  fallbackRequestHandler: ((request: Request) => Result) | null = null;
  /**
   * Fallback notification handler
   */
  fallbackNotificationHandler: ((notification: Notification) => void) | null = null;

  /**
   * Creates a new Protocol instance
   * @param options - Optional protocol options
   */
  constructor(options: ProtocolOptions | null = null) {
    this._options = options || new ProtocolOptions();

    // Use setupDefaultHandlers to set up default handlers
    const defaultHandlers: Array<[string, (notification: JSONRPCNotification) => void]> = [
      ["notifications/cancelled", (notification: JSONRPCNotification) => {
        if (!notification.params) return;

        const params = CancelledNotificationParams.extract<CancelledNotificationParams>(notification.params);
        if (!params) return;

        if (params.requestId !== null) {
          const controller = this._requestHandlerAbortControllers.get(params.requestId);
          if (controller) {
            controller.abort(params.reason || "Request cancelled by client");
          }
        }
      }],
      ["notifications/progress", (notification: JSONRPCNotification) => {
        if (!notification.params) return;

        const result = ProgressNotificationParams.validate(notification.params);
        if (!result.valid) return;

        this._onprogress(notification);
      }]
    ];

    setupDefaultHandlers(this, defaultHandlers);

    this.setRequestHandler("ping", (_request: JSONRPCRequest, _extra: RequestHandlerExtra) => {
      return ({} as unknown) as Result;  // Automatic pong
    });
  }

  // ===== Timeout management methods =====

  /**
   * Sets up a timeout for a message
   * @param messageId - The message ID
   * @param timeout - The timeout duration
   * @param maxTotalTimeout - The maximum total timeout
   * @param onTimeout - The timeout callback
   * @param resetTimeoutOnProgress - Whether to reset timeout on progress
   */
  private _setupTimeout(
    messageId: i32,
    timeout: i32,
    maxTotalTimeout: i32,
    onTimeout: () => void,
    resetTimeoutOnProgress: boolean = false
  ): void {
    const timeoutId = Timer.setTimeout(onTimeout, timeout);
    this._timeoutInfo.set(messageId, new TimeoutInfo(
      timeoutId,
      Timer.now(),
      timeout,
      maxTotalTimeout,
      resetTimeoutOnProgress,
      onTimeout
    ));
  }

  /**
   * Resets the timeout for a message
   * @param messageId - The message ID
   * @returns Whether the timeout was reset
   */
  private _resetTimeout(messageId: i32): boolean {
    const info = this._timeoutInfo.get(messageId);
    if (!info) return false;

    const totalElapsed = Timer.now() - info.startTime;
    if (info.maxTotalTimeout > 0 && totalElapsed >= info.maxTotalTimeout) {
      this._timeoutInfo.delete(messageId);
      throw createTimeoutError(info.maxTotalTimeout, "Maximum total timeout exceeded");
    }

    Timer.clearTimeout(info.timeoutId);
    info.timeoutId = Timer.setTimeout(info.onTimeout, info.timeout);
    return true;
  }

  /**
   * Cleans up timeout information for a message
   * @param messageId - The message ID
   */
  private _cleanupTimeout(messageId: i32): void {
    const timeoutInfo = this._timeoutInfo.get(messageId);
    if (timeoutInfo) {
      Timer.clearTimeout(timeoutInfo.timeoutId);
      this._timeoutInfo.delete(messageId);
    }
  }

  // ===== Connection management =====

  /**
   * Connects to a transport
   * @param transport - The transport to connect to
   */
  connect(transport: Transport): void {
    this._transport = transport;

    this._transport.onclose = () => {
      this._onclose();
    };

    this._transport.onerror = (error: Error) => {
      this._onerror(error);
    };

    this._transport.onmessage = (message: JSONRPCMessage, extra: { authInfo: AuthInfo | null } | null) => {
      this._onmessage(message, extra);
    };

    this._transport.start();
  }

  // ===== Message processing methods =====

  /**
   * Checks if a message is a JSON-RPC response
   * @param message - The message to check
   * @returns Whether the message is a JSON-RPC response
   */
  private isJSONRPCResponse(message: JSONRPCMessage): boolean {
    if (Array.isArray(message)) return false;
    return JSONRPCResponse.extract(message) !== null;
  }

  /**
   * Checks if a message is a JSON-RPC error
   * @param message - The message to check
   * @returns Whether the message is a JSON-RPC error
   */
  private isJSONRPCError(message: JSONRPCMessage): boolean {
    if (Array.isArray(message)) return false;
    return JSONRPCError.extract(message) !== null;
  }

  /**
   * Checks if a message is a JSON-RPC request
   * @param message - The message to check
   * @returns Whether the message is a JSON-RPC request
   */
  private isJSONRPCRequest(message: JSONRPCMessage): message is JSONRPCRequest {
    if (Array.isArray(message)) return false;
    return JSONRPCRequest.extract(message) !== null;
  }

  /**
   * Checks if a message is a JSON-RPC notification
   * @param message - The message to check
   * @returns Whether the message is a JSON-RPC notification
   */
  private isJSONRPCNotification(message: JSONRPCMessage): message is JSONRPCNotification {
    if (Array.isArray(message)) return false;
    return JSONRPCNotification.extract(message) !== null;
  }

  /**
   * Handles incoming messages
   * @param message - The message to handle
   * @param extra - Additional message information
   */
  private _onmessage(message: JSONRPCMessage, extra: { authInfo: AuthInfo | null } | null): void {
    if (this.isJSONRPCResponse(message) || this.isJSONRPCError(message)) {
      this._onresponse(message as JSONRPCResponse | JSONRPCError);
    } else if (this.isJSONRPCRequest(message)) {
      this._onrequest(message as JSONRPCRequest, extra);
    } else if (this.isJSONRPCNotification(message)) {
      this._onnotification(message as JSONRPCNotification);
    } else {
      this._onerror(new Error("Unknown message type received"));
    }
  }

  /**
   * Handles progress notifications
   * @param notification - The progress notification
   */
  private _onprogress(notification: JSONRPCNotification): void {
    if (!notification.params) {
      this._onerror(new Error("Invalid progress notification: params missing"));
      return;
    }

    const params = ProgressNotificationParams.create(
      notification.params.progressToken as string | i32 | null,
      notification.params.progress as number,
      notification.params.total as number | null,
      notification.params.message as string | null
    );

    if (!params.isValid()) {
      this._onerror(new Error("Invalid progress notification: invalid params"));
      return;
    }

    if (params.progressToken === null) {
      this._onerror(new Error("Progress token missing in notification"));
      return;
    }

    const messageId = typeof params.progressToken === "number"
      ? params.progressToken as i32
      : parseInt(params.progressToken.toString());

    const handler = this._progressHandlers.get(messageId);

    if (!handler) {
      return; // Ignore progress for unknown tokens
    }

    const timeoutInfo = this._timeoutInfo.get(messageId);
    if (timeoutInfo && timeoutInfo.resetTimeoutOnProgress) {
      try {
        this._resetTimeout(messageId);
      } catch (error) {
        const callback = this._responseHandlers.get(messageId);
        if (callback) {
          callback(null, error as Error);
        }
        return;
      }
    }

    const progressData: Progress = {
      progress: params.progress,
      total: params.total || undefined,
      message: params.message || undefined
    };

    handler(progressData);
  }

  /**
   * Handles connection close events
   */
  private _onclose(): void {
    const responseHandlers = this._responseHandlers;
    this._responseHandlers = new Map();
    this._progressHandlers.clear();

    // Iterate over timeouts and clear them
    const timeoutKeys: i32[] = [];
    const keys = this._timeoutInfo.keys();
    for (let i = 0; i < keys.length; i++) {
      timeoutKeys.push(keys[i]);
    }
    for (let i = 0; i < timeoutKeys.length; i++) {
      const messageId = timeoutKeys[i];
      if (this._timeoutInfo.has(messageId)) {
        this._cleanupTimeout(messageId);
      }
    }

    this._timeoutInfo.clear();
    this._transport = null;

    if (this.onclose) {
      this.onclose();
    }

    const error = new McpError(ErrorCode.ConnectionClosed, "Connection closed", null);

    // Iterate over response handlers and call them with error
    const responseKeys = responseHandlers.keys();
    for (let i = 0; i < responseKeys.length; i++) {
      const messageId = responseKeys[i];
      const callback = responseHandlers.get(messageId);
      if (callback) {
        callback(null, error);
      }
    }
  }

  /**
   * Handles error events
   * @param error - The error to handle
   */
  private _onerror(error: Error): void {
    if (this.onerror) {
      this.onerror(error);
    }
  }

  /**
   * Handles notification messages
   * @param notification - The notification to handle
   */
  private _onnotification(notification: JSONRPCNotification): void {
    const handler = this._notificationHandlers.get(notification.method) || this.fallbackNotificationHandler;
    if (!handler) return;

    try {
      handler(notification);
    } catch (e) {
      const error = e as Error;
      this._onerror(new Error(`Uncaught error in notification handler: ${error.message}`));
    }
  }

  /**
   * Handles request messages
   * @param request - The request to handle
   * @param extra - Additional request information
   */
  private _onrequest(request: JSONRPCRequest, extra: { authInfo: AuthInfo | null } | null): void {
    const handler = this._requestHandlers.get(request.method) || this.fallbackRequestHandler;

    if (!handler) {
      sendError(this._transport, request.id, ErrorCode.MethodNotFound, "Method not found");
      return;
    }

    const abortController = new AbortController();
    this._requestHandlerAbortControllers.set(request.id, abortController);

    const fullExtra = new RequestHandlerExtra(request.id, abortController.signal);
    fullExtra._setProtocol(this);

    if (extra && extra.authInfo) {
      fullExtra.authInfo = extra.authInfo;
    }
    if (this._transport) {
      fullExtra.sessionId = this._transport.sessionId;
    }

    // Handle _meta extraction properly
    if (request.params) {
      const params = RequestParamsWithMeta.extract<RequestParamsWithMeta>(request.params);
      if (params) {
        fullExtra._meta = params._meta;
      }
    }

    try {
      const result = handler(request, fullExtra);
      if (!abortController.signal.aborted) {
        sendResult(this._transport, request.id, result);
      }
    } catch (e) {
      if (e instanceof McpError) {
        if (!abortController.signal.aborted) {
          sendError(
            this._transport,
            request.id,
            e.code,
            e.message || "Internal error",
            e.data
          );
        }
      } else if (e instanceof Error) {
        if (!abortController.signal.aborted) {
          sendError(
            this._transport,
            request.id,
            ErrorCode.InternalError,
            e.message || "Internal error",
            null
          );
        }
      } else {
        if (!abortController.signal.aborted) {
          sendError(
            this._transport,
            request.id,
            ErrorCode.InternalError,
            "Unknown error occurred",
            null
          );
        }
      }
    } finally {
      this._requestHandlerAbortControllers.delete(request.id);
    }
  }

  /**
   * Handles response messages
   * @param response - The response to handle
   */
  private _onresponse(response: JSONRPCResponse | JSONRPCError): void {
    const messageId = response.id as i32;
    const handler = this._responseHandlers.get(messageId);

    if (!handler) {
      return; // Ignore responses for unknown message IDs
    }

    cleanupRequest(messageId, [this._responseHandlers, this._progressHandlers], this._timeoutInfo);

    if ("error" in response) {
      const error = new McpError(
        <ErrorCode>response.error.code,
        response.error.message,
        response.error.data as Map<string, string> | null
      );
      handler(null, error);
    } else {
      handler(response.result as Result, null);
    }
  }

  // ===== Public API =====

  /**
   * Gets the current transport
   */
  get transport(): Transport | null {
    return this._transport;
  }

  /**
   * Closes the connection
   */
  close(): void {
    if (this._transport) {
      this._transport.close();
    }
  }

  /**
   * Asserts that a capability exists for a method
   * @param method - The method to check
   * @abstract
   */
  protected abstract assertCapabilityForMethod(method: string): void;

  /**
   * Asserts that a notification capability exists
   * @param method - The method to check
   * @abstract
   */
  protected abstract assertNotificationCapability(method: string): void;

  /**
   * Asserts that a request handler capability exists
   * @param method - The method to check
   * @abstract
   */
  protected abstract assertRequestHandlerCapability(method: string): void;

  /**
   * Sends a request
   * @param request - The request to send
   * @param options - Optional request options
   * @param callback - Callback for handling the response
   */
  request(
    request: JSONRPCRequest,
    options: RequestOptions | null = null,
    callback: RequestCallback
  ): void {
    if (!this._transport) {
      callback(null, new Error("Not connected"));
      return;
    }

    if (this._options && this._options.enforceStrictCapabilities) {
      try {
        this.assertCapabilityForMethod(request.method);
      } catch (e) {
        if (e instanceof Error) {
          callback(null, e);
        } else {
          callback(null, new Error("Unknown error occurred"));
        }
        return;
      }
    }

    const messageId = this._requestMessageId++;
    const jsonrpcRequest = JSONRPCRequest.create(messageId, request.method, request.params);
    if (!jsonrpcRequest) {
      callback(null, new Error("Invalid request parameters"));
      return;
    }

    if (options && options.signal && options.signal.aborted) {
      callback(null, new Error(options.signal.reason || "The operation was aborted"));
      return;
    }

    if (options && options.onprogress) {
      this._progressHandlers.set(messageId, options.onprogress);
      jsonrpcRequest.addMetadata("progressToken", messageId.toString());
    }

    this._responseHandlers.set(messageId, (result: Result | null, error: Error | null) => {
      callback(result as Result, error);
    });

    const timeout = options ? options.timeout : DEFAULT_REQUEST_TIMEOUT_MSEC;
    const maxTotalTimeout = options ? options.maxTotalTimeout : 0;
    const resetTimeoutOnProgress = options ? options.resetTimeoutOnProgress : false;

    const timeoutHandler = (): void => {
      cleanupRequest(messageId, [this._responseHandlers, this._progressHandlers], this._timeoutInfo);
      const callback = this._responseHandlers.get(messageId);
      if (callback) {
        callback(null, createTimeoutError(timeout));
      }
    };

    this._setupTimeout(
      messageId,
      timeout,
      maxTotalTimeout,
      timeoutHandler,
      resetTimeoutOnProgress
    );

    // Handle cancellation
    if (options && options.signal) {
      const abortHandler = (): void => {
        cleanupRequest(messageId, [this._responseHandlers, this._progressHandlers], this._timeoutInfo);

        // Use the helper function for creating the notification
        const cancelNotification = createCancelledNotification(
          messageId,
          options.signal!.reason || "Request cancelled"
        );
        sendNotification(this._transport, cancelNotification);

        callback(null, new Error(options.signal!.reason || "The operation was aborted"));
      };

      options.signal.on("abort", abortHandler);
    }

    try {
      sendJsonRpcMessage(this._transport, jsonrpcRequest);
    } catch (e) {
      cleanupRequest(messageId, [this._responseHandlers, this._progressHandlers], this._timeoutInfo);
      if (e instanceof Error) {
        callback(null, e);
      } else {
        callback(null, new Error("Unknown error occurred"));
      }
    }
  }

  /**
   * Sends a notification
   * @param notification - The notification to send
   * @param options - Optional notification options
   */
  notification(notification: JSONRPCNotification, options: NotificationOptions | null = null): void {
    if (!this._transport) {
      throw new Error("Not connected");
    }

    try {
      this.assertNotificationCapability(notification.method);
    } catch (e) {
      if (e instanceof Error) {
        this._onerror(e);
      } else {
        this._onerror(new Error("Unknown error occurred"));
      }
      return;
    }

    const jsonrpcNotification = JSONRPCNotification.create(notification.method, notification.params);
    if (!jsonrpcNotification) {
      this._onerror(new Error("Failed to create JSON-RPC notification"));
      return;
    }

    try {
      sendNotification(this._transport, jsonrpcNotification);
    } catch (e) {
      if (e instanceof Error) {
        this._onerror(e);
      } else {
        this._onerror(new Error("Unknown error occurred"));
      }
    }
  }

  /**
   * Sets a request handler
   * @param method - The method to handle
   * @param handler - The handler function
   */
  setRequestHandler(
    method: string,
    handler: (request: JSONRPCRequest, extra: RequestHandlerExtra) => Result
  ): void {
    this.assertRequestHandlerCapability(method);
    this._requestHandlers.set(method, handler);
  }

  /**
   * Removes a request handler
   * @param method - The method to remove the handler for
   */
  removeRequestHandler(method: string): void {
    this._requestHandlers.delete(method);
  }

  /**
   * Asserts that a request handler can be set
   * @param method - The method to check
   * @throws Error if a handler already exists
   */
  assertCanSetRequestHandler(method: string): void {
    if (this._requestHandlers.has(method)) {
      throw new Error(
        `A request handler for ${method} already exists, which would be overridden`
      );
    }
  }

  /**
   * Sets a notification handler
   * @param method - The method to handle
   * @param handler - The handler function
   */
  setNotificationHandler(
    method: string,
    handler: (notification: JSONRPCNotification) => void
  ): void {
    this._notificationHandlers.set(method, handler);
  }

  /**
   * Removes a notification handler
   * @param method - The method to remove the handler for
   */
  removeNotificationHandler(method: string): void {
    this._notificationHandlers.delete(method);
  }
}