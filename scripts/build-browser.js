import * as esbuild from 'esbuild';

// Bundle for the browser
await esbuild.build({
  entryPoints: ['src/browser.ts'],
  bundle: true,
  outfile: 'public/js/bundle.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  external: [
    'worker_threads',
    'fs/promises',
    'module',
    'fs',
    'path',
    'process',
    'os',
    'crypto',
    'stream',
    'util',
    'events',
    'buffer',
    'url',
    'assert',
    'timers',
    'tty',
    'zlib',
    'http',
    'https',
    'net',
    'dns',
    'dgram',
    'querystring',
    'string_decoder',
    'punycode',
    'readline',
    'repl',
    'vm',
    'child_process',
    'cluster',
    'domain',
    'perf_hooks',
    'v8',
    'worker_threads'
  ],
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  loader: {
    '.ts': 'ts',
  },
}); 