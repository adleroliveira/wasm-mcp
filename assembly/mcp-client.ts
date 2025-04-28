import {
  ClientCapabilities,
  Implementation,
  LoggingLevel,
  ServerCapabilities,
  Result,
  validateResult,
  CompletionResult,
  PromptResult,
  validatePromptResult,
  ResourceListResult,
  validateResourceListResult,
} from "./schema";
import {
  Protocol
} from "./protocol";

import {
  ProtocolOptions,
  RequestOptions,
} from "./protocol-types";

import { Transport } from "./transport";
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, generateRequestId } from "./constants";
import { JSONRPCRequest, JSONRPCNotification } from "./jsonrpc-messages";
import { completeRequestValidator, completeResponseValidator } from "./mcp-schemas";

class ClientCapabilitiesImpl implements ClientCapabilities {
  experimental?: { [key: string]: boolean } = {};
  roots?: {
    listChanged?: boolean;
  } = {};
  sampling?: boolean = false;
}

/**
 * WebAssembly-based MCP (Model Control Protocol) Client implementation.
 * This class provides a client-side implementation of the MCP protocol for WebAssembly environments.
 * It handles communication with an MCP server, manages capabilities, and provides methods for various
 * protocol operations like completion, resource management, and tool interactions.
 * 
 * @example
 * ```typescript
 * const client = new WasmMcpClient(clientInfo, capabilities);
 * client.connect(transport);
 * ```
 */
export class WasmMcpClient extends Protocol {
  private _clientInfo: Implementation;
  private _serverCapabilities: ServerCapabilities | null;
  private _serverVersion: Implementation | null;
  private _capabilities: ClientCapabilities;
  private _instructions: string | null;

  /**
   * Creates a new instance of the WasmMcpClient.
   * 
   * @param clientInfo - Information about the client implementation
   * @param capabilities - Optional client capabilities to register
   */
  constructor(clientInfo: Implementation, capabilities: ClientCapabilities | null = null) {
    super(new ProtocolOptions());
    this._clientInfo = clientInfo;
    this._serverCapabilities = null;
    this._serverVersion = null;
    this._capabilities = capabilities || new ClientCapabilitiesImpl();
    this._instructions = null;
  }

  /**
   * Registers additional client capabilities with the server.
   * This must be called before connecting to the server.
   * 
   * @param capabilities - The capabilities to register
   * @throws Error if called after connecting to the server
   */
  registerCapabilities(capabilities: ClientCapabilities): void {
    if (this._serverCapabilities !== null) {
      throw new Error("Cannot register capabilities after connecting to server");
    }

    // Merge capabilities in an AssemblyScript-friendly way
    if (capabilities.experimental) {
      this._capabilities.experimental = capabilities.experimental;
    }
    if (capabilities.roots) {
      this._capabilities.roots = capabilities.roots;
    }
    if (capabilities.sampling) {
      this._capabilities.sampling = capabilities.sampling;
    }
  }

  /**
   * Gets the server's capabilities that were negotiated during initialization.
   * 
   * @returns The server's capabilities or null if not yet connected
   */
  getServerCapabilities(): ServerCapabilities | null {
    return this._serverCapabilities;
  }

  /**
   * Gets the server's version information.
   * 
   * @returns The server's implementation details or null if not yet connected
   */
  getServerVersion(): Implementation | null {
    return this._serverVersion;
  }

  /**
   * Gets the instructions provided by the server during initialization.
   * 
   * @returns The server's instructions or null if not yet connected
   */
  getInstructions(): string | null {
    return this._instructions;
  }

  /**
   * Establishes a connection with the MCP server using the provided transport.
   * This initiates the protocol handshake and negotiates capabilities.
   * 
   * @param transport - The transport layer to use for communication
   * @param options - Optional request options for the connection
   * @throws Error if initialization fails or protocol version is incompatible
   */
  connect(transport: Transport, options: RequestOptions | null = null): void {
    super.connect(transport);

    // When transport sessionId is already set this means we are trying to reconnect
    if (transport.sessionId !== null) {
      return;
    }

    // Initialize the connection with proper JSON-RPC message validation
    const initRequest = JSONRPCRequest.create(generateRequestId(), "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: this._capabilities,
      clientInfo: this._clientInfo
    });

    if (!initRequest) {
      throw new Error("Failed to create valid initialize request");
    }

    this.request(
      initRequest,
      options,
      (result: Result | null, error: Error | null): void => {
        if (error) {
          this.close();
          throw error;
        }

        if (!result || !validateResult(result)) {
          this.close();
          throw new Error("Server sent invalid initialize result");
        }

        // Check protocol version compatibility
        const serverProtocolVersion = result.protocolVersion as string;
        if (!SUPPORTED_PROTOCOL_VERSIONS.includes(serverProtocolVersion)) {
          this.close();
          throw new Error(`Server's protocol version is not supported: ${serverProtocolVersion}`);
        }

        this._serverCapabilities = result.capabilities as ServerCapabilities;
        this._serverVersion = result.serverInfo as Implementation;
        this._instructions = result.instructions as string | null;

        const initNotification = JSONRPCNotification.create("notifications/initialized", {});
        if (!initNotification) {
          this.close();
          throw new Error("Failed to create initialized notification");
        }
        this.notification(initNotification);
      }
    );
  }

  /**
   * Sends a ping request to the server to check connectivity.
   * 
   * @param options - Optional request options for the ping
   */
  ping(options: RequestOptions | null = null): void {
    const pingRequest = JSONRPCRequest.create(generateRequestId(), "ping");
    if (!pingRequest) {
      throw new Error("Failed to create valid ping request");
    }

    this.request(pingRequest, options, (_result: Result | null, error: Error | null): void => {
      if (error) {
        throw error;
      }
    });
  }

  /**
   * Requests a completion from the server for the given prompt.
   * 
   * @param params - The completion parameters including the prompt
   * @param options - Optional request options
   * @returns The completion result or null if the request fails
   * @throws Error if the completion capability is not supported
   */
  complete(params: { prompt: string }, options: RequestOptions | null = null): CompletionResult | null {
    this.assertCapabilityForMethod("completion/complete");

    // Validate request parameters
    const paramsValidation = completeRequestValidator.validate(params);
    if (!paramsValidation.valid) {
      throw new Error(`Invalid completion request parameters: ${paramsValidation.errors.join(", ")}`);
    }

    const completeRequest = JSONRPCRequest.create(generateRequestId(), "completion/complete", params);
    if (!completeRequest) {
      throw new Error("Failed to create valid completion request");
    }

    let completionResult: CompletionResult | null = null;

    this.request(
      completeRequest,
      options,
      (result: Result | null, error: Error | null): void => {
        if (error) {
          throw error;
        }
        if (result) {
          // Validate response against schema
          const responseValidation = completeResponseValidator.validate(result);
          if (!responseValidation.valid) {
            throw new Error(`Invalid completion response: ${responseValidation.errors.join(", ")}`);
          }

          completionResult = {
            text: result.text as string,
            isComplete: result.isComplete as boolean
          };
        }
      }
    );

    return completionResult;
  }

  /**
   * Sets the logging level for the client.
   * 
   * @param level - The desired logging level
   * @param options - Optional request options
   * @throws Error if the logging capability is not supported
   */
  setLoggingLevel(level: LoggingLevel, options?: RequestOptions): void {
    this.assertCapabilityForMethod("logging/setLevel");

    const setLevelRequest = JSONRPCRequest.create(generateRequestId(), "logging/setLevel", { level });
    if (!setLevelRequest) {
      throw new Error("Failed to create valid set logging level request");
    }

    this.request(
      setLevelRequest,
      options,
      (_result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
      }
    );
  }

  /**
   * Retrieves a prompt by its ID from the server.
   * 
   * @param params - Parameters containing the prompt ID
   * @param options - Optional request options
   * @returns The prompt result or null if not found
   * @throws Error if the prompts capability is not supported
   */
  getPrompt(params: { id: string }, options?: RequestOptions): PromptResult | null {
    this.assertCapabilityForMethod("prompts/get");

    const getPromptRequest = JSONRPCRequest.create(generateRequestId(), "prompts/get", params);
    if (!getPromptRequest) {
      throw new Error("Failed to create valid get prompt request");
    }

    let promptResult: PromptResult | null = null;

    this.request(
      getPromptRequest,
      options,
      (result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
        if (result && validateResult(result) && validatePromptResult(result)) {
          promptResult = (result as unknown) as PromptResult;
        }
      }
    );

    return promptResult;
  }

  /**
   * Lists available prompts from the server.
   * 
   * @param params - Optional filter parameters
   * @returns The list of prompts
   * @throws Error if the prompts capability is not supported
   */
  listPrompts(params?: any): any {
    this.assertCapabilityForMethod("prompts/list");

    const listPromptsRequest = JSONRPCRequest.create(generateRequestId(), "prompts/list", params || {});
    if (!listPromptsRequest) {
      throw new Error("Failed to create valid list prompts request");
    }

    let promptsResult: any = null;

    this.request(
      listPromptsRequest,
      undefined,
      (result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
        if (result && validateResult(result)) {
          promptsResult = result;
        }
      }
    );

    return promptsResult;
  }

  /**
   * Lists available resources from the server.
   * 
   * @param params - Optional filter parameters
   * @param options - Optional request options
   * @returns The list of resources or null if the request fails
   * @throws Error if the resources capability is not supported
   */
  listResources(params?: { filter?: string }, options?: RequestOptions): ResourceListResult | null {
    this.assertCapabilityForMethod("resources/list");

    const listResourcesRequest = JSONRPCRequest.create(generateRequestId(), "resources/list", params || {});
    if (!listResourcesRequest) {
      throw new Error("Failed to create valid list resources request");
    }

    let resourceListResult: ResourceListResult | null = null;

    this.request(
      listResourcesRequest,
      options,
      (result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
        if (result && validateResult(result) && validateResourceListResult(result)) {
          resourceListResult = (result as unknown) as ResourceListResult;
        }
      }
    );

    return resourceListResult;
  }

  /**
   * Lists available resource templates from the server.
   * 
   * @param params - Optional filter parameters
   * @param options - Optional request options
   * @returns The list of resource templates or null if the request fails
   * @throws Error if the resources capability is not supported
   */
  listResourceTemplates(params?: { filter?: string }, options?: RequestOptions): ResourceListResult | null {
    this.assertCapabilityForMethod("resources/templates/list");

    const listTemplatesRequest = JSONRPCRequest.create(generateRequestId(), "resources/templates/list", params || {});
    if (!listTemplatesRequest) {
      throw new Error("Failed to create valid list templates request");
    }

    let templatesResult: ResourceListResult | null = null;

    this.request(
      listTemplatesRequest,
      options,
      (result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
        if (result && validateResult(result) && validateResourceListResult(result)) {
          templatesResult = (result as unknown) as ResourceListResult;
        }
      }
    );

    return templatesResult;
  }

  /**
   * Reads the content of a specific resource from the server.
   * 
   * @param params - Parameters containing the resource ID
   * @param options - Optional request options
   * @returns The resource content or null if not found
   * @throws Error if the resources capability is not supported
   */
  readResource(params: { id: string }, options?: RequestOptions): string | null {
    this.assertCapabilityForMethod("resources/read");

    const readResourceRequest = JSONRPCRequest.create(generateRequestId(), "resources/read", params);
    if (!readResourceRequest) {
      throw new Error("Failed to create valid read resource request");
    }

    let resourceContent: string | null = null;

    this.request(
      readResourceRequest,
      options,
      (result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
        if (result && validateResult(result)) {
          resourceContent = result.content as string;
        }
      }
    );

    return resourceContent;
  }

  /**
   * Subscribes to updates for a specific resource.
   * 
   * @param params - Parameters containing the resource ID
   * @param options - Optional request options
   * @throws Error if the resources capability is not supported
   */
  subscribeResource(params: { id: string }, options?: RequestOptions): void {
    this.assertCapabilityForMethod("resources/subscribe");

    const subscribeRequest = JSONRPCRequest.create(generateRequestId(), "resources/subscribe", params);
    if (!subscribeRequest) {
      throw new Error("Failed to create valid subscribe resource request");
    }

    this.request(
      subscribeRequest,
      options,
      (_result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
      }
    );
  }

  /**
   * Unsubscribes from updates for a specific resource.
   * 
   * @param params - Parameters containing the resource ID
   * @param options - Optional request options
   * @throws Error if the resources capability is not supported
   */
  unsubscribeResource(params: { id: string }, options?: RequestOptions): void {
    this.assertCapabilityForMethod("resources/unsubscribe");

    const unsubscribeRequest = JSONRPCRequest.create(generateRequestId(), "resources/unsubscribe", params);
    if (!unsubscribeRequest) {
      throw new Error("Failed to create valid unsubscribe resource request");
    }

    this.request(
      unsubscribeRequest,
      options,
      (_result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
      }
    );
  }

  /**
   * Calls a specific tool on the server with the given arguments.
   * 
   * @param params - Parameters containing the tool name and arguments
   * @param options - Optional request options
   * @returns The tool result or null if the request fails
   * @throws Error if the tools capability is not supported
   */
  callTool(params: { name: string; args: Map<string, any> }, options?: RequestOptions): Map<string, any> | null {
    this.assertCapabilityForMethod("tools/call");

    const callToolRequest = JSONRPCRequest.create(generateRequestId(), "tools/call", {
      name: params.name,
      args: params.args,
    });
    if (!callToolRequest) {
      throw new Error("Failed to create valid call tool request");
    }

    let toolResult: Map<string, any> | null = null;

    this.request(
      callToolRequest,
      options,
      (result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
        if (result && validateResult(result)) {
          toolResult = result.result as Map<string, any>;
        }
      }
    );

    return toolResult;
  }

  /**
   * Lists available tools from the server.
   * 
   * @param params - Optional filter parameters
   * @param options - Optional request options
   * @returns The list of tools or null if the request fails
   * @throws Error if the tools capability is not supported
   */
  listTools(params?: { filter?: string }, options?: RequestOptions): Map<string, string>[] | null {
    this.assertCapabilityForMethod("tools/list");

    const listToolsRequest = JSONRPCRequest.create(generateRequestId(), "tools/list", params || {});
    if (!listToolsRequest) {
      throw new Error("Failed to create valid list tools request");
    }

    let toolsList: Map<string, string>[] | null = null;

    this.request(
      listToolsRequest,
      options,
      (result: Result | null, error: Error | null) => {
        if (error) {
          throw error;
        }
        if (result && validateResult(result)) {
          toolsList = result.tools as Map<string, string>[];
        }
      }
    );

    return toolsList;
  }

  /**
   * Notifies the server that the list of roots has changed.
   * 
   * @throws Error if the roots capability is not supported
   */
  sendRootsListChanged(): void {
    const rootsListChangedNotification = JSONRPCNotification.create("notifications/roots/list_changed", {});
    if (!rootsListChangedNotification) {
      this.close();
      throw new Error("Failed to create roots list changed notification");
    }
    this.notification(rootsListChangedNotification);
  }

  // Protected methods for capability checking
  /**
   * Asserts that the server supports a specific capability.
   * 
   * @param capability - The capability to check
   * @param method - The method requiring the capability
   * @throws Error if the capability is not supported
   * @protected
   */
  protected assertCapability(capability: keyof ServerCapabilities, method: string): void {
    if (!this._serverCapabilities || !this._serverCapabilities[capability]) {
      throw new Error(`Server does not support ${capability} (required for ${method})`);
    }
  }

  /**
   * Asserts that the server supports the capability required for a specific method.
   * 
   * @param method - The method to check capabilities for
   * @throws Error if the required capability is not supported
   * @protected
   */
  protected assertCapabilityForMethod(method: string): void {
    switch (method) {
      case "logging/setLevel":
        this.assertCapability("logging", method);
        break;

      case "prompts/get":
      case "prompts/list":
        this.assertCapability("prompts", method);
        break;

      case "resources/list":
      case "resources/templates/list":
      case "resources/read":
      case "resources/subscribe":
      case "resources/unsubscribe":
        this.assertCapability("resources", method);
        if (method === "resources/subscribe" && !this._serverCapabilities!.resources!.subscribe) {
          throw new Error(`Server does not support resource subscriptions (required for ${method})`);
        }
        break;

      case "tools/call":
      case "tools/list":
        this.assertCapability("tools", method);
        break;

      case "completion/complete":
        this.assertCapability("completions", method);
        break;

      case "initialize":
      case "ping":
        // No specific capability required
        break;

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Asserts that the client supports a specific notification capability.
   * 
   * @param method - The notification method to check
   * @throws Error if the notification capability is not supported
   * @protected
   */
  protected assertNotificationCapability(method: string): void {
    switch (method) {
      case "notifications/roots/list_changed":
        if (!this._capabilities.roots?.listChanged) {
          throw new Error(`Client does not support roots list changed notifications (required for ${method})`);
        }
        break;

      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress":
        // No specific capability required
        break;

      default:
        throw new Error(`Unknown notification method: ${method}`);
    }
  }

  /**
   * Asserts that the client supports a specific request handler capability.
   * 
   * @param method - The request handler method to check
   * @throws Error if the request handler capability is not supported
   * @protected
   */
  protected assertRequestHandlerCapability(method: string): void {
    switch (method) {
      case "sampling/createMessage":
        if (!this._capabilities.sampling) {
          throw new Error(`Client does not support sampling capability (required for ${method})`);
        }
        break;

      case "roots/list":
        if (!this._capabilities.roots) {
          throw new Error(`Client does not support roots capability (required for ${method})`);
        }
        break;

      case "ping":
        // No specific capability required
        break;

      default:
        throw new Error(`Unknown request handler method: ${method}`);
    }
  }
}