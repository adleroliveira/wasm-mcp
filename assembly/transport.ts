// Import necessary types
import { JSONRPCMessage, RequestId } from "./schema";

/**
 * Authentication information that can be passed with messages
 */
export class AuthInfo {
  /**
   * The access token.
   */
  token: string;

  /**
   * The client ID associated with this token.
   */
  clientId: string;

  /**
   * Scopes associated with this token.
   */
  scopes: string[];

  /**
   * When the token expires (in seconds since epoch).
   */
  expiresAt: i64 | null = null;

  /**
   * Additional data associated with the token.
   * This field should be used for any additional data that needs to be attached to the auth info.
   */
  extra: Map<string, unknown> | null = null;

  constructor(token: string, clientId: string, scopes: string[]) {
    this.token = token;
    this.clientId = clientId;
    this.scopes = scopes;
  }
}

/**
 * Options for sending a JSON-RPC message.
 */
export class TransportSendOptions {
  /** 
   * If present, `relatedRequestId` is used to indicate to the transport which incoming request to associate this outgoing message with.
   */
  relatedRequestId: RequestId | null = null;

  /**
   * The resumption token used to continue long-running requests that were interrupted.
   *
   * This allows clients to reconnect and continue from where they left off, if supported by the transport.
   */
  resumptionToken: string | null = null;

  /**
   * A callback that is invoked when the resumption token changes, if supported by the transport.
   *
   * This allows clients to persist the latest token for potential reconnection.
   */
  onresumptiontoken: ((token: string) => void) | null = null;
}

/**
 * Describes the minimal contract for a MCP transport that a client or server can communicate over.
 */
export abstract class Transport {
  /**
   * Starts processing messages on the transport, including any connection steps that might need to be taken.
   *
   * This method should only be called after callbacks are installed, or else messages may be lost.
   *
   * NOTE: This method should not be called explicitly when using Client, Server, or Protocol classes, as they will implicitly call start().
   */
  abstract start(): void;

  /**
   * Sends a JSON-RPC message (request or response).
   * 
   * If present, `relatedRequestId` is used to indicate to the transport which incoming request to associate this outgoing message with.
   */
  abstract send(message: JSONRPCMessage, options: TransportSendOptions | null): void;

  /**
   * Closes the connection.
   */
  abstract close(): void;

  /**
   * Callback for when the connection is closed for any reason.
   *
   * This should be invoked when close() is called as well.
   */
  onclose: (() => void) | null = null;

  /**
   * Callback for when an error occurs.
   *
   * Note that errors are not necessarily fatal; they are used for reporting any kind of exceptional condition out of band.
   */
  onerror: ((error: Error) => void) | null = null;

  /**
   * Callback for when a message (request or response) is received over the connection.
   * 
   * Includes the authInfo if the transport is authenticated.
   */
  onmessage: ((message: JSONRPCMessage, extra: { authInfo: AuthInfo | null } | null) => void) | null = null;

  /**
   * The session ID generated for this connection.
   */
  sessionId: string | null = null;
}
