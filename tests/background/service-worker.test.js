/**
 * Property-based tests for service worker module
 * 
 * Feature: elevenlabs-reader
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

// Mock Chrome APIs
const mockStorage = new Map();

const chromeMock = {
  storage: {
    local: {
      set: vi.fn((items, callback) => {
        Object.entries(items).forEach(([key, value]) => {
          mockStorage.set(key, JSON.parse(JSON.stringify(value)));
        });
        callback?.();
      }),
      get: vi.fn((keys, callback) => {
        const result = {};
        const keyList = keys === null ? Array.from(mockStorage.keys()) : (Array.isArray(keys) ? keys : [keys]);
        keyList.forEach(key => {
          if (mockStorage.has(key)) {
            result[key] = mockStorage.get(key);
          }
        });
        callback?.(result);
      })
    }
  },
  runtime: {
    lastError: null,
    onMessage: {
      addListener: vi.fn()
    },
    sendMessage: vi.fn(),
    getContexts: vi.fn().mockResolvedValue([])
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    onRemoved: {
      addListener: vi.fn()
    },
    onUpdated: {
      addListener: vi.fn()
    }
  },
  offscreen: {
    createDocument: vi.fn().mockResolvedValue(undefined)
  }
};

// Set up global chrome mock
globalThis.chrome = chromeMock;


// Import service worker module after setting up mock
const serviceWorkerModule = await import('../../src/background/service-worker.js');

describe('Service Worker Module - Property Tests', () => {
  beforeEach(() => {
    mockStorage.clear();
    chromeMock.runtime.lastError = null;
    vi.clearAllMocks();
  });

  /**
   * Property 5: Speed Value Application
   * For any valid speed value between 0.5 and 3.0, setting the playback speed
   * should result in the audio playback rate matching that value, and the
   * current playback position should remain unchanged.
   */
  describe('Property 5: Speed Value Application', () => {
    
    it('should accept and store any valid speed value between 0.5 and 3.0', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.5, max: 3.0, noNaN: true }),
          async (speed) => {
            // Call handleSetSpeed with the speed value
            const result = await serviceWorkerModule.handleSetSpeed({ speed });
            
            // Should succeed
            expect(result.success).toBe(true);
            
            // State should reflect the new speed
            const state = serviceWorkerModule.getPlaybackState();
            expect(state.speed).toBe(speed);
            
            // Speed should be persisted to storage
            expect(mockStorage.get('playbackSpeed')).toBe(speed);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject speed values below 0.5', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: -100, max: 0.49, noNaN: true }),
          async (invalidSpeed) => {
            const result = await serviceWorkerModule.handleSetSpeed({ speed: invalidSpeed });
            
            // Should fail
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject speed values above 3.0', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 3.01, max: 100, noNaN: true }),
          async (invalidSpeed) => {
            const result = await serviceWorkerModule.handleSetSpeed({ speed: invalidSpeed });
            
            // Should fail
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject non-numeric speed values', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.string(),
            fc.boolean(),
            fc.array(fc.integer()),
            fc.object()
          ),
          async (invalidSpeed) => {
            const result = await serviceWorkerModule.handleSetSpeed({ speed: invalidSpeed });
            
            // Should fail
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve playback position when speed changes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.5, max: 3.0, noNaN: true }),
          fc.double({ min: 0.5, max: 3.0, noNaN: true }),
          fc.double({ min: 0, max: 1000, noNaN: true }),
          async (initialSpeed, newSpeed, position) => {
            // Set initial speed
            await serviceWorkerModule.handleSetSpeed({ speed: initialSpeed });
            
            // Simulate a playback position by updating state
            await serviceWorkerModule.updatePlaybackState({ currentTime: position });
            
            // Change speed
            await serviceWorkerModule.handleSetSpeed({ speed: newSpeed });
            
            // Position should remain unchanged
            const state = serviceWorkerModule.getPlaybackState();
            expect(state.currentTime).toBe(position);
            expect(state.speed).toBe(newSpeed);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle boundary speed values correctly', async () => {
      // Test exact boundary values
      const boundaryValues = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
      
      for (const speed of boundaryValues) {
        const result = await serviceWorkerModule.handleSetSpeed({ speed });
        expect(result.success).toBe(true);
        
        const state = serviceWorkerModule.getPlaybackState();
        expect(state.speed).toBe(speed);
      }
    });
  });
});
