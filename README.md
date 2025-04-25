# WASM MCP

A project that demonstrates the integration of TypeScript and AssemblyScript for WebAssembly development.

## Project Structure

```
.
├── assembly/         # AssemblyScript source files
├── src/             # TypeScript source files
├── build/           # Compiled WebAssembly files
├── dist/            # Compiled TypeScript files
├── package.json     # Project dependencies and scripts
├── tsconfig.json    # TypeScript configuration
└── asconfig.json    # AssemblyScript configuration
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

This will:
- Compile TypeScript files to JavaScript
- Compile AssemblyScript files to WebAssembly

## Development

- TypeScript files are in the `src` directory
- AssemblyScript files are in the `assembly` directory
- Use `npm run build:ts` to compile only TypeScript files
- Use `npm run build:as` to compile only AssemblyScript files

## Testing

Run tests with:
```bash
npm test
``` 