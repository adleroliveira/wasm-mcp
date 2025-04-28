import { SchemaType, SchemaValidator } from "./schema-validator";

// Base schema types
export const baseSchema = new Map<string, SchemaType>();
baseSchema.set("jsonrpc", SchemaType.string().makeNullable());
baseSchema.set("id", SchemaType.union([
  SchemaType.string(),
  SchemaType.number()
]));

// Request schemas
export const requestSchema = new Map<string, SchemaType>();
requestSchema.set("jsonrpc", SchemaType.string().makeNullable());
requestSchema.set("id", SchemaType.union([
  SchemaType.string(),
  SchemaType.number()
]));
requestSchema.set("method", SchemaType.string());
requestSchema.set("params", SchemaType.object());

// Response schemas
export const responseSchema = new Map<string, SchemaType>();
responseSchema.set("jsonrpc", SchemaType.string().makeNullable());
responseSchema.set("id", SchemaType.union([
  SchemaType.string(),
  SchemaType.number()
]));
responseSchema.set("result", SchemaType.object());

// Error schemas
const errorObjectSchema = new Map<string, SchemaType>();
errorObjectSchema.set("code", SchemaType.number());
errorObjectSchema.set("message", SchemaType.string());
errorObjectSchema.set("data", SchemaType.object().makeNullable());

export const errorSchema = new Map<string, SchemaType>();
errorSchema.set("jsonrpc", SchemaType.string().makeNullable());
errorSchema.set("id", SchemaType.union([
  SchemaType.string(),
  SchemaType.number()
]));
errorSchema.set("error", SchemaType.object(errorObjectSchema));

// Specific MCP message schemas
const clientInfoSchema = new Map<string, SchemaType>();
clientInfoSchema.set("name", SchemaType.string());
clientInfoSchema.set("version", SchemaType.string());

const initializeParamsSchema = new Map<string, SchemaType>();
initializeParamsSchema.set("protocolVersion", SchemaType.string());
initializeParamsSchema.set("capabilities", SchemaType.object());
initializeParamsSchema.set("clientInfo", SchemaType.object(clientInfoSchema));

export const initializeRequestSchema = new Map<string, SchemaType>();
initializeRequestSchema.set("jsonrpc", SchemaType.string().makeNullable());
initializeRequestSchema.set("id", SchemaType.union([
  SchemaType.string(),
  SchemaType.number()
]));
initializeRequestSchema.set("method", SchemaType.string());
initializeRequestSchema.set("params", SchemaType.object(initializeParamsSchema));

const completeParamsSchema = new Map<string, SchemaType>();
completeParamsSchema.set("prompt", SchemaType.string());

export const completeRequestSchema = new Map<string, SchemaType>();
completeRequestSchema.set("jsonrpc", SchemaType.string().makeNullable());
completeRequestSchema.set("id", SchemaType.union([
  SchemaType.string(),
  SchemaType.number()
]));
completeRequestSchema.set("method", SchemaType.string());
completeRequestSchema.set("params", SchemaType.object(completeParamsSchema));

const completeResultSchema = new Map<string, SchemaType>();
completeResultSchema.set("text", SchemaType.string());
completeResultSchema.set("isComplete", SchemaType.boolean());

export const completeResponseSchema = new Map<string, SchemaType>();
completeResponseSchema.set("jsonrpc", SchemaType.string().makeNullable());
completeResponseSchema.set("id", SchemaType.union([
  SchemaType.string(),
  SchemaType.number()
]));
completeResponseSchema.set("result", SchemaType.object(completeResultSchema));

// Schema validators
export const initializeRequestValidator = new SchemaValidator(initializeRequestSchema);
export const completeRequestValidator = new SchemaValidator(completeRequestSchema);
export const completeResponseValidator = new SchemaValidator(completeResponseSchema); 