/**
 * Simple Timer implementation (host must provide these functions)
 */
declare function setTimeout(callback: () => void, duration: i32): i32;
declare function clearTimeout(id: i32): void;
declare function Date_now(): i32;

/**
 * Timer utilities for protocol implementations
 */
export class Timer {
  /**
   * Get the current timestamp in milliseconds since epoch
   */
  static now(): i32 {
    return Date_now();
  }

  /**
   * Set a timeout with the given duration
   */
  static setTimeout(callback: () => void, duration: i32): i32 {
    return setTimeout(callback, duration);
  }

  /**
   * Clear a timeout with the given id
   */
  static clearTimeout(id: i32): void {
    clearTimeout(id);
  }
} 