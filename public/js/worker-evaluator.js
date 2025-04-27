import { Worker } from 'worker_threads';
// Main thread implementation
export class WorkerEvaluator {
    constructor() {
        this.worker = null;
        this.messageHandlers = new Set();
        this.isBrowser = typeof window !== 'undefined';
    }
    on(event, handler) {
        this.messageHandlers.add(handler);
    }
    notifyMessageHandlers() {
        this.messageHandlers.forEach(handler => handler());
    }
    async initialize() {
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
            this.worker = new Worker(workerUrl);
        }
        else {
            // In Node.js, use worker_threads
            console.log('Initializing worker in Node.js');
            const workerPath = new URL('./worker-code.js', import.meta.url).pathname.replace('src/', 'dist/');
            console.log('Worker path:', workerPath);
            try {
                this.worker = new Worker(workerPath);
                console.log('Worker created successfully');
            }
            catch (error) {
                console.error('Failed to create worker:', error);
                throw error;
            }
        }
    }
    async evaluate(code) {
        if (!this.worker) {
            console.log('Worker not initialized, initializing now...');
            await this.initialize();
        }
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('Worker not initialized'));
                return;
            }
            const messageHandler = (event) => {
                console.log('Received worker response:', event.data); // Debug log
                console.log('Event type:', event.constructor.name); // Debug log
                let response;
                if (this.isBrowser) {
                    response = event.data;
                }
                else {
                    // In Node.js, the event is the response itself
                    response = event;
                }
                if (!response || typeof response !== 'object') {
                    console.error('Invalid response format:', response); // Debug log
                    console.error('Event structure:', event); // Debug log
                    reject(new Error('Invalid worker response format'));
                    return;
                }
                // Clean up event listeners
                if (this.isBrowser) {
                    this.worker.removeEventListener('message', messageHandler);
                }
                else {
                    this.worker.removeListener('message', messageHandler);
                }
                // Notify message handlers
                this.notifyMessageHandlers();
                if (response.success) {
                    resolve();
                }
                else {
                    reject(new Error(response.error || 'Unknown error'));
                }
            };
            // Set up event listeners
            if (this.isBrowser) {
                this.worker.addEventListener('message', messageHandler);
            }
            else {
                this.worker.on('message', messageHandler);
            }
            console.log('Sending code to worker:', code); // Debug log
            this.worker.postMessage({ type: 'evaluate', code });
        });
    }
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
//# sourceMappingURL=worker-evaluator.js.map