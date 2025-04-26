import { getHelloWorld } from '../../build/debug.js';

async function runTest() {
  try {
    // Call the function and log the result
    console.log('Node.js Test:');
    const result = await getHelloWorld();
    console.log(result);
  } catch (error) {
    console.error('Error running Node.js test:', error);
  }
}

// Use top-level await since we're in an ES module
await runTest(); 