import { parentPort } from 'worker_threads';

// Type for the worker message
interface WorkerMessage {
  type: 'evaluate';
  code: string;
}

// Type for the worker response
interface WorkerResponse {
  success: boolean;
  error?: string | null;
}

// This is the Node.js worker code
if (parentPort) {
  parentPort.on('message', (message: WorkerMessage) => {
    if (message.type === 'evaluate') {
      try {
        const fn = new Function(message.code);
        fn();
        const response: WorkerResponse = { success: true, error: null };
        parentPort!.postMessage(response);
      } catch (error: unknown) {
        const response: WorkerResponse = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        parentPort!.postMessage(response);
      }
    }
  });
} else {
  console.log('Worker code loaded but parentPort is not available');
} 