/**
 * Simple EventEmitter implementation for AssemblyScript
 */
export class EventEmitter {
  private listeners: Map<string, Array<() => void>> = new Map();

  /**
   * Adds an event listener
   * @param event - The event name
   * @param callback - The callback function to be called when the event is emitted
   */
  on(event: string, callback: () => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    const callbacks = this.listeners.get(event)!;
    callbacks.push(callback);
  }

  /**
   * Emits an event, calling all registered listeners
   * @param event - The event name to emit
   */
  emit(event: string): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i]();
      }
    }
  }

  /**
   * Removes an event listener
   * @param event - The event name
   * @param callback - The callback function to remove
   */
  removeListener(event: string, callback: () => void): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }
} 