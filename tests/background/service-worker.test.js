/**
 * Property-based tests for service worker module
 * 
 * Feature: elevenlabs-reader
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

// Mock Chrome APIs
const mockStorage = new Map();
let broadcastedMessages = [];

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
    sendMessage: vi.fn((message) => {
      broadcastedMessages.push({ target: 'popup', ...message });
      return Promise.resolve();
    }),
    getContexts: vi.fn().mockResolvedValue([])
  },
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    sendMessage: vi.fn((tabId, message) => {
      broadcastedMessages.push({ target: `tab-${tabId}`, ...message });
      return Promise.resolve();
    }),
    onRemoved: {
      addListener: vi.fn()
    },
    onUpdated: {
      addListener: vi.fn()
    },
    onActivated: {
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
    broadcastedMessages = [];
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

  /**
   * Property 9: State Synchronization Consistency
   * For any playback state change event, querying the state from the service worker,
   * content script, and popup (if open) should return equivalent playback state objects.
   * 
   * Feature: elevenlabs-reader, Property 9: State Synchronization Consistency
   */
  describe('Property 9: State Synchronization Consistency', () => {
    
    it('should broadcast consistent state to all listeners on any state change', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random playback state updates
          fc.record({
            status: fc.constantFrom('idle', 'loading', 'playing', 'paused', 'error'),
            currentParagraphIndex: fc.nat({ max: 100 }),
            currentSentenceIndex: fc.nat({ max: 50 }),
            currentWordIndex: fc.nat({ max: 200 }),
            currentTime: fc.double({ min: 0, max: 3600, noNaN: true }),
            speed: fc.double({ min: 0.5, max: 3.0, noNaN: true }),
            error: fc.option(fc.string(), { nil: null })
          }),
          async (stateUpdate) => {
            // Clear previous broadcasts
            broadcastedMessages = [];
            
            // Update playback state
            await serviceWorkerModule.updatePlaybackState(stateUpdate);
            
            // Get the current state from service worker
            const serviceWorkerState = serviceWorkerModule.getPlaybackState();
            
            // Verify state was updated correctly
            expect(serviceWorkerState.status).toBe(stateUpdate.status);
            expect(serviceWorkerState.currentParagraphIndex).toBe(stateUpdate.currentParagraphIndex);
            expect(serviceWorkerState.currentSentenceIndex).toBe(stateUpdate.currentSentenceIndex);
            expect(serviceWorkerState.currentWordIndex).toBe(stateUpdate.currentWordIndex);
            expect(serviceWorkerState.currentTime).toBe(stateUpdate.currentTime);
            expect(serviceWorkerState.speed).toBe(stateUpdate.speed);
            
            // Verify broadcasts were sent
            expect(broadcastedMessages.length).toBeGreaterThan(0);
            
            // All broadcasted messages should contain the same state
            for (const broadcast of broadcastedMessages) {
              if (broadcast.type === 'playbackStateChange' && broadcast.state) {
                expect(broadcast.state.status).toBe(serviceWorkerState.status);
                expect(broadcast.state.currentParagraphIndex).toBe(serviceWorkerState.currentParagraphIndex);
                expect(broadcast.state.currentSentenceIndex).toBe(serviceWorkerState.currentSentenceIndex);
                expect(broadcast.state.currentWordIndex).toBe(serviceWorkerState.currentWordIndex);
                expect(broadcast.state.currentTime).toBe(serviceWorkerState.currentTime);
                expect(broadcast.state.speed).toBe(serviceWorkerState.speed);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should broadcast to all tabs and popup on state change', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('idle', 'playing', 'paused'),
          async (status) => {
            // Clear previous broadcasts
            broadcastedMessages = [];
            
            // Update state
            await serviceWorkerModule.updatePlaybackState({ status });
            
            // Should have broadcasts to tabs (2 tabs in mock) and popup
            const tabBroadcasts = broadcastedMessages.filter(m => m.target.startsWith('tab-'));
            const popupBroadcasts = broadcastedMessages.filter(m => m.target === 'popup');
            
            // Should broadcast to all tabs
            expect(tabBroadcasts.length).toBe(2);
            
            // Should attempt to broadcast to popup
            expect(popupBroadcasts.length).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return consistent state via GET_STATE handler', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            status: fc.constantFrom('idle', 'loading', 'playing', 'paused', 'error'),
            speed: fc.double({ min: 0.5, max: 3.0, noNaN: true }),
            currentTime: fc.double({ min: 0, max: 3600, noNaN: true })
          }),
          async (stateUpdate) => {
            // Update state
            await serviceWorkerModule.updatePlaybackState(stateUpdate);
            
            // Query state via handler (simulates content script or popup query)
            const response = serviceWorkerModule.handleGetState();
            
            // Response should be successful
            expect(response.success).toBe(true);
            expect(response.state).toBeDefined();
            
            // State should match what was set
            expect(response.state.status).toBe(stateUpdate.status);
            expect(response.state.speed).toBe(stateUpdate.speed);
            expect(response.state.currentTime).toBe(stateUpdate.currentTime);
            
            // State should also match direct query
            const directState = serviceWorkerModule.getPlaybackState();
            expect(response.state.status).toBe(directState.status);
            expect(response.state.speed).toBe(directState.speed);
            expect(response.state.currentTime).toBe(directState.currentTime);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain state consistency across multiple rapid updates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              status: fc.constantFrom('idle', 'playing', 'paused'),
              speed: fc.double({ min: 0.5, max: 3.0, noNaN: true })
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (updates) => {
            // Apply multiple rapid updates
            for (const update of updates) {
              await serviceWorkerModule.updatePlaybackState(update);
            }
            
            // Final state should match last update
            const lastUpdate = updates[updates.length - 1];
            const finalState = serviceWorkerModule.getPlaybackState();
            
            expect(finalState.status).toBe(lastUpdate.status);
            expect(finalState.speed).toBe(lastUpdate.speed);
            
            // GET_STATE should return same final state
            const response = serviceWorkerModule.handleGetState();
            expect(response.state.status).toBe(lastUpdate.status);
            expect(response.state.speed).toBe(lastUpdate.speed);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
