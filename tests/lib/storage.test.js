/**
 * Property-based tests for storage utility module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

// Mock Chrome storage API
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
      }),
      remove: vi.fn((keys, callback) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(key => mockStorage.delete(key));
        callback?.();
      }),
      clear: vi.fn((callback) => {
        mockStorage.clear();
        callback?.();
      })
    }
  },
  runtime: {
    lastError: null
  }
};

// Set up global chrome mock
globalThis.chrome = chromeMock;

// Import storage module after setting up mock
const { saveSettings, getSettings, getAllSettings, clearAllSettings, STORAGE_KEYS } = await import('../../lib/storage.js');

describe('Storage Module - Property Tests', () => {
  beforeEach(() => {
    mockStorage.clear();
    chromeMock.runtime.lastError = null;
    vi.clearAllMocks();
  });

  /**
   * Property 1: Settings Persistence Round-Trip
   * For any valid settings value (API key, voice ID, or playback speed),
   * storing the value to Chrome storage and then retrieving it should return an equivalent value.
   */
  describe('Property 1: Settings Persistence Round-Trip', () => {
    it('should round-trip string values (API keys, voice IDs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.constantFrom(STORAGE_KEYS.API_KEY, STORAGE_KEYS.SELECTED_VOICE_ID),
          async (value, key) => {
            // Store the value
            await saveSettings(key, value);
            
            // Retrieve the value
            const retrieved = await getSettings(key);
            
            // Should be equivalent
            expect(retrieved).toBe(value);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should round-trip numeric values (playback speed)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.5, max: 3.0, noNaN: true }),
          async (speed) => {
            // Store the speed value
            await saveSettings(STORAGE_KEYS.PLAYBACK_SPEED, speed);
            
            // Retrieve the value
            const retrieved = await getSettings(STORAGE_KEYS.PLAYBACK_SPEED);
            
            // Should be equivalent
            expect(retrieved).toBe(speed);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should round-trip array values (cached voices)', async () => {
      const voiceArbitrary = fc.record({
        voice_id: fc.string({ minLength: 1, maxLength: 50 }),
        name: fc.string({ minLength: 1, maxLength: 100 }),
        category: fc.string({ minLength: 1, maxLength: 50 })
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(voiceArbitrary, { minLength: 0, maxLength: 20 }),
          async (voices) => {
            // Store the voices array
            await saveSettings(STORAGE_KEYS.CACHED_VOICES, voices);
            
            // Retrieve the value
            const retrieved = await getSettings(STORAGE_KEYS.CACHED_VOICES);
            
            // Should be deeply equivalent
            expect(retrieved).toEqual(voices);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should round-trip arbitrary JSON-serializable values', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.jsonValue(),
          async (key, value) => {
            // Store the value
            await saveSettings(key, value);
            
            // Retrieve the value
            const retrieved = await getSettings(key);
            
            // Should be deeply equivalent (JSON round-trip)
            expect(retrieved).toEqual(value);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should persist multiple settings independently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.double({ min: 0.5, max: 3.0, noNaN: true }),
          async (apiKey, voiceId, speed) => {
            // Store multiple values
            await saveSettings(STORAGE_KEYS.API_KEY, apiKey);
            await saveSettings(STORAGE_KEYS.SELECTED_VOICE_ID, voiceId);
            await saveSettings(STORAGE_KEYS.PLAYBACK_SPEED, speed);
            
            // Retrieve all settings
            const all = await getAllSettings();
            
            // Each should be independently correct
            expect(all[STORAGE_KEYS.API_KEY]).toBe(apiKey);
            expect(all[STORAGE_KEYS.SELECTED_VOICE_ID]).toBe(voiceId);
            expect(all[STORAGE_KEYS.PLAYBACK_SPEED]).toBe(speed);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
