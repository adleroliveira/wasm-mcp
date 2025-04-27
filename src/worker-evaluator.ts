// Type for the worker response
interface WorkerResponse {
  success: boolean;
  error?: string | null;
}

// Union type for both Node.js and browser workers
type WorkerType = import('worker_threads').Worker | globalThis.Worker;

// Main thread implementation
export class WorkerEvaluator {
  private worker: WorkerType | null = null;
  private isBrowser: boolean;
  private messageHandlers: Set<() => void> = new Set();

  constructor() {
    this.isBrowser = typeof window !== 'undefined';
  }

  on(event: 'message', handler: () => void): void {
    this.messageHandlers.add(handler);
  }

  private notifyMessageHandlers(): void {
    this.messageHandlers.forEach(handler => handler());
  }

  async initialize(): Promise<void> {
    if (this.isBrowser) {
      // In browser, create a Blob URL for the worker
      const workerCode = `
        onmessage = (event) => {
          const { type, code } = event.data;
          if (type === 'evaluate') {
            try {
              const fn = new Function(code);
              fn();
              postMessage({ success: true, error: null });
            } catch (error) {
              postMessage({ success: false, error: error.message });
            }
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new globalThis.Worker(workerUrl);
    } else {
      // In Node.js, use worker_threads
      const { Worker } = await import('worker_threads');
      const workerPath = new URL('./worker-code.js', import.meta.url).pathname.replace('src/', 'dist/');
      try {
        this.worker = new Worker(workerPath);
      } catch (error) {
        console.error('Failed to create worker:', error);
        throw error;
      }
    }
  }

  async evaluate(code: string): Promise<void> {
    if (!this.worker) {
      console.log('Worker not initialized, initializing now...');
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const messageHandler = (event: MessageEvent | { data: WorkerResponse }) => {

        let response: WorkerResponse;
        if (this.isBrowser) {
          response = (event as MessageEvent).data;
        } else {
          // In Node.js, the event is the response itself
          response = (event as unknown as WorkerResponse);
        }

        if (!response || typeof response !== 'object') {
          console.error('Invalid response format:', response); // Debug log
          console.error('Event structure:', event); // Debug log
          reject(new Error('Invalid worker response format'));
          return;
        }

        // Clean up event listeners
        if (this.isBrowser) {
          (this.worker as globalThis.Worker).removeEventListener('message', messageHandler);
        } else {
          (this.worker as import('worker_threads').Worker).removeListener('message', messageHandler);
        }

        // Notify message handlers
        this.notifyMessageHandlers();

        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      };

      // Set up event listeners
      if (this.isBrowser) {
        (this.worker as globalThis.Worker).addEventListener('message', messageHandler);
      } else {
        (this.worker as import('worker_threads').Worker).on('message', messageHandler);
      }

      this.worker.postMessage({ type: 'evaluate', code });
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
} 