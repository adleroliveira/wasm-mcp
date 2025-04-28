/**
 * SchemaValidator provides robust type validation for AssemblyScript
 * Supports primitives, arrays, objects, unions, recursive schemas, and custom validators
 */
export class SchemaValidator {
  private schema: Map<string, SchemaType>;
  private strict: boolean;
  private namedSchemas: Map<string, SchemaType>;

  constructor(schema: Map<string, SchemaType>, strict: boolean = false) {
    this.schema = schema;
    this.strict = strict;
    this.namedSchemas = new Map<string, SchemaType>();
  }

  /**
   * Registers a named schema for recursive validation
   */
  registerNamedSchema(name: string, schema: SchemaType): void {
    this.namedSchemas.set(name, schema);
  }

  /**
   * Validates an object against the schema
   * @returns ValidationResult with validity and errors
   */
  validate(obj: unknown): ValidationResult {
    const result = new ValidationResult();

    if (!obj || typeof obj !== "object") {
      result.addError("root", "Expected object");
      return result;
    }

    const input = obj as { [key: string]: unknown };
    const schemaKeys = this.schema.keys();

    // Check for missing required properties
    for (let i = 0; i < schemaKeys.length; i++) {
      const key = schemaKeys[i];
      const typeDef = this.schema.get(key)!;

      if (!(key in input) && !typeDef.isNullable) {
        result.addError(key, "Required property missing");
        continue;
      }

      if (key in input && !this.validateValue(input[key], typeDef, key, result)) {
        continue;
      }
    }

    // Check for extra properties in strict mode
    if (this.strict) {
      for (const key in input) {
        if (!this.schema.has(key)) {
          result.addError(key, "Unexpected property");
        }
      }
    }

    return result;
  }

  /**
   * Validates a single value against a type definition
   */
  private validateValue(value: unknown, typeDef: SchemaType, path: string, result: ValidationResult): boolean {
    // Handle null/undefined
    if (value === null || value === undefined) {
      if (!typeDef.isNullable) {
        result.addError(path, "Value cannot be null or undefined");
        return false;
      }
      return true;
    }

    // Handle recursive reference
    if (typeDef.type === "reference" && typeDef.referenceName) {
      const refSchema = this.namedSchemas.get(typeDef.referenceName);
      if (!refSchema) {
        result.addError(path, `Unknown schema reference: ${typeDef.referenceName}`);
        return false;
      }
      return this.validateValue(value, refSchema, path, result);
    }

    // Handle primitive types
    if (typeDef.type === "string") {
      if (typeof value !== "string") {
        result.addError(path, `Expected string, got ${typeof value}`);
        return false;
      }
      if (typeDef.minLength !== null && value.length < typeDef.minLength) {
        result.addError(path, `String length must be at least ${typeDef.minLength}`);
        return false;
      }
      if (typeDef.maxLength !== null && value.length > typeDef.maxLength) {
        result.addError(path, `String length must be at most ${typeDef.maxLength}`);
        return false;
      }
      return true;
    } else if (typeDef.type === "number") {
      if (typeof value !== "number") {
        result.addError(path, `Expected number, got ${typeof value}`);
        return false;
      }
      if (typeDef.min !== null && value < typeDef.min) {
        result.addError(path, `Number must be at least ${typeDef.min}`);
        return false;
      }
      if (typeDef.max !== null && value > typeDef.max) {
        result.addError(path, `Number must be at most ${typeDef.max}`);
        return false;
      }
      return true;
    } else if (typeDef.type === "boolean") {
      if (typeof value !== "boolean") {
        result.addError(path, `Expected boolean, got ${typeof value}`);
        return false;
      }
      return true;
    }

    // Handle arrays
    if (typeDef.type === "array") {
      if (!Array.isArray(value)) {
        result.addError(path, `Expected array, got ${typeof value}`);
        return false;
      }
      if (typeDef.minLength !== null && value.length < typeDef.minLength) {
        result.addError(path, `Array length must be at least ${typeDef.minLength}`);
        return false;
      }
      if (typeDef.maxLength !== null && value.length > typeDef.maxLength) {
        result.addError(path, `Array length must be at most ${typeDef.maxLength}`);
        return false;
      }
      if (typeDef.items) {
        for (let i = 0; i < value.length; i++) {
          if (!this.validateValue(value[i], typeDef.items, `${path}[${i}]`, result)) {
            return false;
          }
        }
      }
      return true;
    }

    // Handle objects
    if (typeDef.type === "object") {
      if (typeof value !== "object" || value === null) {
        result.addError(path, `Expected object, got ${typeof value}`);
        return false;
      }
      if (typeDef.properties) {
        const obj = value as { [key: string]: unknown };
        const propKeys = typeDef.properties.keys();
        for (let i = 0; i < propKeys.length; i++) {
          const propKey = propKeys[i];
          const propType = typeDef.properties.get(propKey)!;
          if (!(propKey in obj) && !propType.isNullable) {
            result.addError(`${path}.${propKey}`, "Required property missing");
            continue;
          }
          if (propKey in obj && !this.validateValue(obj[propKey], propType, `${path}.${propKey}`, result)) {
            return false;
          }
        }
      }
      return true;
    }

    // Handle union types
    if (typeDef.type === "union" && typeDef.types) {
      let valid = false;
      for (let i = 0; i < typeDef.types.length; i++) {
        const subResult = new ValidationResult();
        if (this.validateValue(value, typeDef.types[i], path, subResult)) {
          valid = true;
          break;
        }
      }
      if (!valid) {
        result.addError(path, "Value does not match any union type");
      }
      return valid;
    }

    // Handle custom validators
    if (typeDef.type === "custom" && typeDef.customValidator) {
      const isValid = typeDef.customValidator(value);
      if (!isValid) {
        result.addError(path, "Custom validation failed");
      }
      return isValid;
    }

    result.addError(path, `Unknown type: ${typeDef.type}`);
    return false;
  }

  /**
   * Extracts and validates parameters from an object
   * @returns The validated object or null if validation fails
   */
  extract<T>(obj: unknown): T | null {
    const result = this.validate(obj);
    if (!result.valid) {
      return null;
    }
    return obj as T;
  }
}

/**
 * Represents a validation result with errors
 */
export class ValidationResult {
  valid: boolean = true;
  errors: Array<string> = [];

  addError(path: string, message: string): void {
    this.valid = false;
    this.errors.push(`${path}: ${message}`);
  }
}

/**
 * Represents a type definition in the schema
 */
export class SchemaType {
  type: "string" | "number" | "boolean" | "array" | "object" | "union" | "custom" | "reference";
  isNullable: boolean = false;
  minLength: i32 | null = null; // For strings and arrays
  maxLength: i32 | null = null; // For strings and arrays
  min: f64 | null = null; // For numbers
  max: f64 | null = null; // For numbers
  items: SchemaType | null = null; // For arrays
  properties: Map<string, SchemaType> | null = null; // For objects
  types: SchemaType[] | null = null; // For unions
  customValidator: ((value: unknown) => boolean) | null = null; // For custom
  referenceName: string | null = null; // For references

  constructor(type: SchemaType["type"]) {
    this.type = type;
  }

  static string(minLength: i32 | null = null, maxLength: i32 | null = null): SchemaType {
    const type = new SchemaType("string");
    type.minLength = minLength;
    type.maxLength = maxLength;
    return type;
  }

  static number(min: f64 | null = null, max: f64 | null = null): SchemaType {
    const type = new SchemaType("number");
    type.min = min;
    type.max = max;
    return type;
  }

  static boolean(): SchemaType {
    return new SchemaType("boolean");
  }

  static array(items: SchemaType | null = null, minLength: i32 | null = null, maxLength: i32 | null = null): SchemaType {
    const type = new SchemaType("array");
    type.items = items;
    type.minLength = minLength;
    type.maxLength = maxLength;
    return type;
  }

  static object(properties: Map<string, SchemaType> | null = null): SchemaType {
    const type = new SchemaType("object");
    type.properties = properties;
    return type;
  }

  static union(types: SchemaType[]): SchemaType {
    const type = new SchemaType("union");
    type.types = types;
    return type;
  }

  static custom(validator: (value: unknown) => boolean): SchemaType {
    const type = new SchemaType("custom");
    type.customValidator = validator;
    return type;
  }

  static reference(name: string): SchemaType {
    const type = new SchemaType("reference");
    type.referenceName = name;
    return type;
  }

  makeNullable(): SchemaType {
    this.isNullable = true;
    return this;
  }
}