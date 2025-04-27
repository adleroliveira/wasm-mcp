import * as esbuild from 'esbuild';

// Bundle for the browser
await esbuild.build({
  entryPoints: ['src/browser.ts'],
  bundle: true,
  outfile: 'public/js/bundle.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  external: ['worker_threads'], // Don't bundle Node.js specific modules
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  loader: {
    '.ts': 'ts',
  },
}); 