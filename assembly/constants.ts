export const PROTOCOL_VERSION = "1.0";
export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION];

// Simple counter for generating unique IDs
let requestIdCounter: i32 = 0;

export function generateRequestId(): i32 {
  requestIdCounter++;
  return requestIdCounter;
}

/**
 * The default request timeout in milliseconds
 */
export const DEFAULT_REQUEST_TIMEOUT_MSEC: i32 = 60000; 