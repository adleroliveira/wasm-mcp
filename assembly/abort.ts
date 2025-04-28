import { EventEmitter } from "./event-emitter";

/**
 * Simple AbortSignal implementation for AssemblyScript
 * @extends EventEmitter
 */
export class AbortSignal extends EventEmitter {
  private _aborted: boolean = false;
  private _reason: string = "";

  /**
   * Gets whether the operation has been aborted
   */
  get aborted(): boolean {
    return this._aborted;
  }

  /**
   * Gets the reason for the abort
   */
  get reason(): string {
    return this._reason;
  }

  /**
   * Throws an error if the operation has been aborted
   * @throws Error if the operation has been aborted
   */
  throwIfAborted(): void {
    if (this._aborted) {
      throw new Error(this._reason || "The operation was aborted");
    }
  }

  /**
   * Internal method to abort the operation
   * @param reason - The reason for aborting
   */
  _abort(reason: string): void {
    if (!this._aborted) {
      this._aborted = true;
      this._reason = reason;
      this.emit("abort");
    }
  }
}

/**
 * Simple AbortController implementation for AssemblyScript
 */
export class AbortController {
  private _signal: AbortSignal = new AbortSignal();

  /**
   * Gets the AbortSignal associated with this controller
   */
  get signal(): AbortSignal {
    return this._signal;
  }

  /**
   * Aborts the operation
   * @param reason - The reason for aborting
   */
  abort(reason: string = "The operation was aborted"): void {
    this._signal._abort(reason);
  }
} 