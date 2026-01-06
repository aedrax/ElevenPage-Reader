/**
 * Property-based tests for popup UI module
 * 
 * Feature: elevenlabs-reader
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { JSDOM } from 'jsdom';

// Setup DOM environment
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <select id="voice-select">
    <option value="">Select a voice...</option>
  </select>
</body>
</html>
`);

global.document = dom.window.document;
global.window = dom.window;

// Mock Chrome APIs
const mockStorage = new Map();

global.chrome = {
  storage: {
    local: {
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
      set: vi.fn((items, callback) => {
        Object.entries(items).forEach(([key, value]) => {
          mockStorage.set(key, value);
        });
        callback?.();
      })
    }
  },
  runtime: {
    sendMessage: vi.fn((message, callback) => {
      callback?.({ success: true });
    }),
    onMessage: {
      addListener: vi.fn()
    },
    lastError: null
  }
};

/**
 * Voice arbitrary generator for property tests
 */
const voiceArbitrary = fc.record({
  voice_id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  category: fc.constantFrom('premade', 'cloned', 'generated', 'professional', 'unknown'),
  labels: fc.constant({})
});

/**
 * Populate voice dropdown - extracted logic for testing
 * @param {HTMLSelectElement} select - The select element
 * @param {Array} voices - Array of voice objects
 * @param {string|null} savedVoiceId - Previously saved voice ID
 */
function populateVoiceDropdown(select, voices, savedVoiceId = null) {
  // Clear existing options except placeholder
  select.innerHTML = '<option value="">Select a voice...</option>';
  
  // Group voices by category
  const categories = {};
  voices.forEach(voice => {
    const category = voice.category || 'Other';
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(voice);
  });

  // Add voices grouped by category
  Object.keys(categories).sort().forEach(category => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = category.charAt(0).toUpperCase() + category.slice(1);
    
    categories[category].forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.voice_id;
      option.textContent = voice.name;
      option.dataset.voiceId = voice.voice_id;
      
      // Pre-select saved voice
      if (savedVoiceId && voice.voice_id === savedVoiceId) {
        option.selected = true;
      }
      
      optgroup.appendChild(option);
    });
    
    select.appendChild(optgroup);
  });
}

/**
 * Get all voice options from a select element
 * @param {HTMLSelectElement} select - The select element
 * @returns {Array} Array of voice IDs from options
 */
function getVoiceOptionsFromSelect(select) {
  const options = [];
  const allOptions = select.querySelectorAll('option[value]:not([value=""])');
  allOptions.forEach(option => {
    options.push({
      voice_id: option.value,
      name: option.textContent
    });
  });
  return options;
}

describe('Popup Module - Property Tests', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
    // Reset select element
    const select = document.getElementById('voice-select');
    select.innerHTML = '<option value="">Select a voice...</option>';
  });

  /**
   * Property 2: Voice List Rendering Completeness
   * For any list of voices returned from the ElevenLabs API,
   * the voice selector dropdown should contain an option for each voice in the list.
   */
  describe('Property 2: Voice List Rendering Completeness', () => {
    
    it('should render exactly one option for each voice in the list', () => {
      fc.assert(
        fc.property(
          fc.array(voiceArbitrary, { minLength: 0, maxLength: 50 }),
          (voices) => {
            const select = document.getElementById('voice-select');
            
            // Populate the dropdown
            populateVoiceDropdown(select, voices);
            
            // Get all rendered voice options (excluding placeholder)
            const renderedOptions = getVoiceOptionsFromSelect(select);
            
            // Should have exactly as many options as voices
            expect(renderedOptions.length).toBe(voices.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include every voice_id from the input list', () => {
      fc.assert(
        fc.property(
          fc.array(voiceArbitrary, { minLength: 1, maxLength: 50 }),
          (voices) => {
            const select = document.getElementById('voice-select');
            
            // Populate the dropdown
            populateVoiceDropdown(select, voices);
            
            // Get all rendered voice IDs
            const renderedOptions = getVoiceOptionsFromSelect(select);
            const renderedVoiceIds = new Set(renderedOptions.map(o => o.voice_id));
            
            // Every input voice_id should be in the rendered options
            voices.forEach(voice => {
              expect(renderedVoiceIds.has(voice.voice_id)).toBe(true);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should display the correct name for each voice', () => {
      fc.assert(
        fc.property(
          fc.array(voiceArbitrary, { minLength: 1, maxLength: 50 }),
          (voices) => {
            const select = document.getElementById('voice-select');
            
            // Populate the dropdown
            populateVoiceDropdown(select, voices);
            
            // Create a map of voice_id to name from input
            const voiceNameMap = new Map(voices.map(v => [v.voice_id, v.name]));
            
            // Get all rendered options
            const renderedOptions = getVoiceOptionsFromSelect(select);
            
            // Each rendered option should have the correct name
            renderedOptions.forEach(option => {
              expect(option.name).toBe(voiceNameMap.get(option.voice_id));
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty voice list gracefully', () => {
      const select = document.getElementById('voice-select');
      
      // Populate with empty list
      populateVoiceDropdown(select, []);
      
      // Should only have the placeholder option
      const renderedOptions = getVoiceOptionsFromSelect(select);
      expect(renderedOptions.length).toBe(0);
      
      // Placeholder should still exist
      const placeholder = select.querySelector('option[value=""]');
      expect(placeholder).not.toBeNull();
      expect(placeholder.textContent).toBe('Select a voice...');
    });

    it('should pre-select saved voice when provided', () => {
      fc.assert(
        fc.property(
          fc.array(voiceArbitrary, { minLength: 2, maxLength: 20 }),
          fc.nat(),
          (voices, indexSeed) => {
            const select = document.getElementById('voice-select');
            
            // Pick a random voice to be the saved one
            const savedIndex = indexSeed % voices.length;
            const savedVoiceId = voices[savedIndex].voice_id;
            
            // Populate with saved voice ID
            populateVoiceDropdown(select, voices, savedVoiceId);
            
            // The saved voice should be selected
            expect(select.value).toBe(savedVoiceId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should group voices by category', () => {
      fc.assert(
        fc.property(
          fc.array(voiceArbitrary, { minLength: 1, maxLength: 30 }),
          (voices) => {
            const select = document.getElementById('voice-select');
            
            // Populate the dropdown
            populateVoiceDropdown(select, voices);
            
            // Get unique categories from input
            const inputCategories = new Set(voices.map(v => v.category || 'Other'));
            
            // Get optgroups from rendered select
            const optgroups = select.querySelectorAll('optgroup');
            
            // Should have an optgroup for each category
            expect(optgroups.length).toBe(inputCategories.size);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not lose any voices during re-population', () => {
      fc.assert(
        fc.property(
          fc.array(voiceArbitrary, { minLength: 1, maxLength: 30 }),
          fc.array(voiceArbitrary, { minLength: 1, maxLength: 30 }),
          (voices1, voices2) => {
            const select = document.getElementById('voice-select');
            
            // Populate first time
            populateVoiceDropdown(select, voices1);
            
            // Populate second time (simulating refresh)
            populateVoiceDropdown(select, voices2);
            
            // Should now have exactly voices2 options
            const renderedOptions = getVoiceOptionsFromSelect(select);
            expect(renderedOptions.length).toBe(voices2.length);
            
            // All voices2 should be present
            const renderedVoiceIds = new Set(renderedOptions.map(o => o.voice_id));
            voices2.forEach(voice => {
              expect(renderedVoiceIds.has(voice.voice_id)).toBe(true);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// Export for potential reuse
export { populateVoiceDropdown, getVoiceOptionsFromSelect };
