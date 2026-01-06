/**
 * Property-based tests for ElevenLabs API client module
 * 
 * Feature: elevenlabs-reader
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

// Import the API module
const { 
  API_ERROR_TYPES, 
  ElevenLabsAPIError, 
  isValidApiKeyFormat,
  textToSpeech,
  getVoices
} = await import('../../lib/elevenlabs-api.js');

describe('ElevenLabs API Module - Property Tests', () => {
  
  /**
   * Property 10: Invalid API Key Blocks TTS
   * For any invalid or empty API key value, attempting to initiate text-to-speech
   * should fail with an appropriate error and not produce audio output.
   */
  describe('Property 10: Invalid API Key Blocks TTS', () => {
    
    it('should reject empty string API keys for textToSpeech', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 500 }), // valid text
          fc.string({ minLength: 1, maxLength: 50 }),  // valid voice ID
          async (text, voiceId) => {
            // Empty string API key should be rejected
            await expect(textToSpeech('', text, voiceId))
              .rejects.toThrow(ElevenLabsAPIError);
            
            try {
              await textToSpeech('', text, voiceId);
            } catch (error) {
              expect(error).toBeInstanceOf(ElevenLabsAPIError);
              expect(error.type).toBe(API_ERROR_TYPES.INVALID_API_KEY);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject whitespace-only API keys for textToSpeech', async () => {
      // Generate whitespace-only strings
      const whitespaceArbitrary = fc.stringOf(
        fc.constantFrom(' ', '\t', '\n', '\r'),
        { minLength: 1, maxLength: 20 }
      );

      await fc.assert(
        fc.asyncProperty(
          whitespaceArbitrary,
          fc.string({ minLength: 1, maxLength: 500 }), // valid text
          fc.string({ minLength: 1, maxLength: 50 }),  // valid voice ID
          async (whitespaceKey, text, voiceId) => {
            // Whitespace-only API key should be rejected
            await expect(textToSpeech(whitespaceKey, text, voiceId))
              .rejects.toThrow(ElevenLabsAPIError);
            
            try {
              await textToSpeech(whitespaceKey, text, voiceId);
            } catch (error) {
              expect(error).toBeInstanceOf(ElevenLabsAPIError);
              expect(error.type).toBe(API_ERROR_TYPES.INVALID_API_KEY);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject non-string API keys for textToSpeech', async () => {
      // Generate various non-string invalid values
      const invalidKeyArbitrary = fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.integer(),
        fc.boolean(),
        fc.array(fc.string()),
        fc.object()
      );

      await fc.assert(
        fc.asyncProperty(
          invalidKeyArbitrary,
          fc.string({ minLength: 1, maxLength: 500 }), // valid text
          fc.string({ minLength: 1, maxLength: 50 }),  // valid voice ID
          async (invalidKey, text, voiceId) => {
            // Non-string API key should be rejected
            await expect(textToSpeech(invalidKey, text, voiceId))
              .rejects.toThrow(ElevenLabsAPIError);
            
            try {
              await textToSpeech(invalidKey, text, voiceId);
            } catch (error) {
              expect(error).toBeInstanceOf(ElevenLabsAPIError);
              expect(error.type).toBe(API_ERROR_TYPES.INVALID_API_KEY);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject empty string API keys for getVoices', async () => {
      await expect(getVoices('')).rejects.toThrow(ElevenLabsAPIError);
      
      try {
        await getVoices('');
      } catch (error) {
        expect(error).toBeInstanceOf(ElevenLabsAPIError);
        expect(error.type).toBe(API_ERROR_TYPES.INVALID_API_KEY);
      }
    });

    it('should reject whitespace-only API keys for getVoices', async () => {
      const whitespaceArbitrary = fc.stringOf(
        fc.constantFrom(' ', '\t', '\n', '\r'),
        { minLength: 1, maxLength: 20 }
      );

      await fc.assert(
        fc.asyncProperty(
          whitespaceArbitrary,
          async (whitespaceKey) => {
            await expect(getVoices(whitespaceKey)).rejects.toThrow(ElevenLabsAPIError);
            
            try {
              await getVoices(whitespaceKey);
            } catch (error) {
              expect(error).toBeInstanceOf(ElevenLabsAPIError);
              expect(error.type).toBe(API_ERROR_TYPES.INVALID_API_KEY);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject non-string API keys for getVoices', async () => {
      const invalidKeyArbitrary = fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.integer(),
        fc.boolean(),
        fc.array(fc.string()),
        fc.object()
      );

      await fc.assert(
        fc.asyncProperty(
          invalidKeyArbitrary,
          async (invalidKey) => {
            await expect(getVoices(invalidKey)).rejects.toThrow(ElevenLabsAPIError);
            
            try {
              await getVoices(invalidKey);
            } catch (error) {
              expect(error).toBeInstanceOf(ElevenLabsAPIError);
              expect(error.type).toBe(API_ERROR_TYPES.INVALID_API_KEY);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('isValidApiKeyFormat helper', () => {
    it('should return false for all invalid API key formats', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(''),
            fc.constant(null),
            fc.constant(undefined),
            fc.integer(),
            fc.boolean(),
            fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 })
          ),
          (invalidKey) => {
            expect(isValidApiKeyFormat(invalidKey)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return true for non-empty strings with non-whitespace characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          (validKey) => {
            expect(isValidApiKeyFormat(validKey)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
