/**
 * Helper utilities for working with JSON-RPC protocol messages and operations.
 * This module provides functions for creating, sending, and handling JSON-RPC requests,
 * responses, notifications, and errors.
 */
import { Transport } from "./transport";
import { RequestId, JSONRPCMessage, ErrorCode, Result, Progress, Request, Notification } from "./schema";
import { JSONRPCNotification, JSONRPCError, JSONRPCResponse } from "./jsonrpc-messages";
import { Protocol } from "./protocol";
import { McpError, TimeoutInfo, CancelledNotificationParams } from "./protocol-types";
import { Timer } from "./timer";

// ===== Error handling utilities =====

/**
 * Creates a timeout error with the specified timeout duration and optional message.
 * 
 * @param timeout - The timeout duration in milliseconds
 * @param message - Optional custom error message
 * @returns A McpError instance with RequestTimeout error code
 */
export function createTimeoutError(timeout: i32, message: string = ""): McpError {
  const fullMessage = message || `Request timed out after ${timeout}ms`;
  return new McpError(ErrorCode.RequestTimeout, fullMessage, null);
}

// ===== Message creation utilities =====

/**
 * Creates a JSON-RPC notification for a cancelled request.
 * 
 * @param requestId - The ID of the request that was cancelled
 * @param reason - Optional reason for cancellation
 * @returns A JSON-RPC notification object
 */
export function createCancelledNotification(requestId: RequestId, reason: string | null): JSONRPCNotification {
  const params = CancelledNotificationParams.create(requestId, reason);
  return JSONRPCNotification.create("notifications/cancelled", {
    requestId: params.requestId,
    reason: params.reason
  })!;
}

// ===== Message handling utilities =====

/**
 * Cleans up resources associated with a request by removing handlers and clearing timeouts.
 * 
 * @param messageId - The ID of the message to clean up
 * @param handlers - Array of handler maps to clear for this message ID
 * @param timeoutInfo - Map of timeout information to clear for this message ID
 */
export function cleanupRequest(messageId: i32, handlers: Map<i32, any>[], timeoutInfo: Map<i32, TimeoutInfo>): void {
  for (let i = 0; i < handlers.length; i++) {
    handlers[i].delete(messageId);
  }
  const info = timeoutInfo.get(messageId);
  if (info) {
    Timer.clearTimeout(info.timeoutId);
    timeoutInfo.delete(messageId);
  }
}

/**
 * Sets up default notification handlers for a protocol instance.
 * 
 * @param protocol - The protocol instance to set up handlers for
 * @param handlers - Array of method name and handler function pairs
 */
export function setupDefaultHandlers(
  protocol: Protocol,
  handlers: Array<[string, (notification: JSONRPCNotification) => void]>
): void {
  for (let i = 0; i < handlers.length; i++) {
    const method = handlers[i][0];
    const handler = handlers[i][1];
    protocol.setNotificationHandler(method, handler);
  }
}

// ===== Message sending utilities =====

/**
 * Sends a JSON-RPC error response through the provided transport.
 * 
 * @param transport - The transport to send the error through
 * @param requestId - The ID of the request being responded to
 * @param code - The error code
 * @param message - The error message
 * @param data - Optional additional error data
 */
export function sendError(transport: Transport | null, requestId: RequestId, code: ErrorCode, message: string, data: any = null): void {
  if (transport) {
    const error = JSONRPCError.create(requestId, code, message, data);
    if (error) {
      transport.send(error, null);
    }
  }
}

/**
 * Sends a JSON-RPC result response through the provided transport.
 * 
 * @param transport - The transport to send the result through
 * @param requestId - The ID of the request being responded to
 * @param result - The result data to send
 */
export function sendResult(transport: Transport | null, requestId: RequestId, result: Result): void {
  if (transport) {
    const response = JSONRPCResponse.create(requestId, result);
    if (response) {
      transport.send(response, null);
    }
  }
}

/**
 * Sends a JSON-RPC notification through the provided transport.
 * 
 * @param transport - The transport to send the notification through
 * @param notification - The notification to send
 */
export function sendNotification(transport: Transport | null, notification: JSONRPCNotification): void {
  if (transport && notification.validate().valid) {
    transport.send(notification, null);
  }
}

/**
 * Sends any JSON-RPC message through the provided transport.
 * 
 * @param transport - The transport to send the message through
 * @param message - The JSON-RPC message to send
 */
export function sendJsonRpcMessage(transport: Transport | null, message: JSONRPCMessage): void {
  if (transport) {
    transport.send(message, null);
  }
}

// ===== Capability merging =====

/**
 * Manually merges capability objects by combining properties from base and additional objects.
 * For nested objects, the function currently uses a simple overwrite strategy due to
 * AssemblyScript's static typing limitations.
 * 
 * @param base - The base object containing default capabilities
 * @param additional - The additional object containing new capabilities
 * @param knownProperties - Array of property names to process
 * @returns A new object containing the merged capabilities
 */
export function mergeCapabilitiesManual<T>(base: T, additional: T, knownProperties: string[]): T {
  // Create a new object that will hold the merged properties
  const result = {} as T;

  // For each known property
  for (let i = 0; i < knownProperties.length; i++) {
    const prop = knownProperties[i];
    const baseObj = base as unknown as { [key: string]: unknown };
    const additionalObj = additional as unknown as { [key: string]: unknown };
    const resultObj = result as unknown as { [key: string]: unknown };

    if (prop in baseObj) {
      resultObj[prop] = baseObj[prop];
    }

    if (prop in additionalObj) {
      const additionalValue = additionalObj[prop];

      if (additionalValue != null && typeof additionalValue === "object" && !Array.isArray(additionalValue)) {
        const baseValue = resultObj[prop];

        if (baseValue != null && typeof baseValue === "object" && !Array.isArray(baseValue)) {
          // For nested objects, you'd need to know their properties too
          // This is a limitation of AssemblyScript's static typing
          resultObj[prop] = additionalValue; // Fallback to overwrite
        } else {
          resultObj[prop] = additionalValue;
        }
      } else {
        resultObj[prop] = additionalValue;
      }
    }
  }

  return result;
} 