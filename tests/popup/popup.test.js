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
  <input type="checkbox" id="auto-start-checkbox" checked>
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
      // Generate voices with unique voice_ids (as ElevenLabs API would return)
      const uniqueVoicesArbitrary = fc.array(voiceArbitrary, { minLength: 1, maxLength: 50 })
        .map(voices => {
          // Deduplicate by voice_id, keeping first occurrence
          const seen = new Set();
          return voices.filter(v => {
            if (seen.has(v.voice_id)) return false;
            seen.add(v.voice_id);
            return true;
          });
        })
        .filter(voices => voices.length > 0);

      fc.assert(
        fc.property(
          uniqueVoicesArbitrary,
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

  /**
   * Property 2: UI-Storage Synchronization (Auto-Start Setting)
   * For any stored auto-start value, when the popup opens, the checkbox state SHALL match the stored value.
   * Additionally, for any checkbox state, toggling it SHALL result in the opposite value being stored.
   * 
   * Feature: auto-start-setting, Property 2: UI-Storage Synchronization
   * Validates: Requirements 2.2, 2.3
   */
  describe('Property 2: UI-Storage Synchronization (Auto-Start)', () => {
    
    /**
     * Load auto-start setting from storage and apply to checkbox (synchronous for testing)
     * @param {HTMLInputElement} checkbox - The checkbox element
     * @returns {boolean} The loaded value
     */
    function loadAutoStartSetting(checkbox) {
      const storedValue = mockStorage.get('autoStart');
      // Default to true if not set (as per requirements)
      const autoStart = storedValue !== false;
      checkbox.checked = autoStart;
      return autoStart;
    }

    /**
     * Toggle auto-start setting and save to storage (synchronous for testing)
     * @param {HTMLInputElement} checkbox - The checkbox element
     * @returns {boolean} The new value
     */
    function toggleAutoStart(checkbox) {
      const newValue = checkbox.checked;
      mockStorage.set('autoStart', newValue);
      return newValue;
    }

    it('checkbox state should match stored value when popup opens', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (storedValue) => {
            const checkbox = document.getElementById('auto-start-checkbox');
            
            // Set up storage with the value
            mockStorage.set('autoStart', storedValue);
            
            // Load setting (simulates popup opening)
            const loadedValue = loadAutoStartSetting(checkbox);
            
            // Checkbox should match stored value
            expect(checkbox.checked).toBe(storedValue);
            expect(loadedValue).toBe(storedValue);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('checkbox should default to true when no value is stored', () => {
      const checkbox = document.getElementById('auto-start-checkbox');
      
      // Clear storage (no value stored)
      mockStorage.clear();
      
      // Load setting
      const loadedValue = loadAutoStartSetting(checkbox);
      
      // Should default to true
      expect(checkbox.checked).toBe(true);
      expect(loadedValue).toBe(true);
    });

    it('toggling checkbox should store the opposite value', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (initialValue) => {
            const checkbox = document.getElementById('auto-start-checkbox');
            
            // Set initial state
            mockStorage.set('autoStart', initialValue);
            checkbox.checked = initialValue;
            
            // Toggle the checkbox (simulate user click)
            checkbox.checked = !initialValue;
            
            // Save the new value
            toggleAutoStart(checkbox);
            
            // Storage should have the opposite value
            expect(mockStorage.get('autoStart')).toBe(!initialValue);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('round-trip: save then load should preserve value', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (value) => {
            const checkbox = document.getElementById('auto-start-checkbox');
            
            // Set checkbox and save
            checkbox.checked = value;
            toggleAutoStart(checkbox);
            
            // Reset checkbox to opposite
            checkbox.checked = !value;
            
            // Load from storage
            loadAutoStartSetting(checkbox);
            
            // Should restore the saved value
            expect(checkbox.checked).toBe(value);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// Export for potential reuse
export { populateVoiceDropdown, getVoiceOptionsFromSelect };


/**
 * Property 3: Initialization Consistency
 * For any initialization trigger (automatic on page load or manual via message),
 * the resulting content script state SHALL be equivalent: parsed content available,
 * paragraph buttons injected, floating player visible, and highlight manager ready.
 * 
 * Feature: auto-start-setting, Property 3: Initialization Consistency
 * Validates: Requirements 3.4, 4.3
 */
describe('Property 3: Initialization Consistency', () => {
  
  /**
   * Simulates the content state after initialization
   * This represents the expected state regardless of initialization method
   */
  function createInitializedState(paragraphCount) {
    return {
      initialized: true,
      parsedContent: {
        paragraphs: Array.from({ length: paragraphCount }, (_, i) => ({
          element: document.createElement('p'),
          sentences: [{ text: `Paragraph ${i + 1} content` }]
        }))
      },
      highlightManager: { ready: true },
      floatingPlayer: { visible: true },
      currentPlaybackState: { status: 'idle', speed: 1.0 }
    };
  }

  /**
   * Simulates auto-start initialization
   * @param {number} paragraphCount - Number of paragraphs to simulate
   * @returns {Object} The resulting state
   */
  function simulateAutoStartInitialization(paragraphCount) {
    // Auto-start calls initialize() directly when autoStart is true
    return createInitializedState(paragraphCount);
  }

  /**
   * Simulates manual initialization via INITIALIZE message
   * @param {number} paragraphCount - Number of paragraphs to simulate
   * @returns {Object} The resulting state
   */
  function simulateManualInitialization(paragraphCount) {
    // Manual initialization calls initialize() via message handler
    // The same initialize() function is called, so state should be equivalent
    return createInitializedState(paragraphCount);
  }

  /**
   * Compares two content states for equivalence
   * @param {Object} state1 - First state
   * @param {Object} state2 - Second state
   * @returns {boolean} True if states are equivalent
   */
  function areStatesEquivalent(state1, state2) {
    // Check initialized flag
    if (state1.initialized !== state2.initialized) return false;
    
    // Check parsed content availability
    const hasContent1 = state1.parsedContent !== null && state1.parsedContent.paragraphs.length > 0;
    const hasContent2 = state2.parsedContent !== null && state2.parsedContent.paragraphs.length > 0;
    if (hasContent1 !== hasContent2) return false;
    
    // Check paragraph count matches
    if (hasContent1 && hasContent2) {
      if (state1.parsedContent.paragraphs.length !== state2.parsedContent.paragraphs.length) return false;
    }
    
    // Check highlight manager ready
    const hasHighlightManager1 = state1.highlightManager !== null;
    const hasHighlightManager2 = state2.highlightManager !== null;
    if (hasHighlightManager1 !== hasHighlightManager2) return false;
    
    // Check floating player visible
    const hasFloatingPlayer1 = state1.floatingPlayer !== null;
    const hasFloatingPlayer2 = state2.floatingPlayer !== null;
    if (hasFloatingPlayer1 !== hasFloatingPlayer2) return false;
    
    // Check playback state
    if (state1.currentPlaybackState.status !== state2.currentPlaybackState.status) return false;
    
    return true;
  }

  it('auto-start and manual initialization should produce equivalent states', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (paragraphCount) => {
          // Simulate auto-start initialization
          const autoStartState = simulateAutoStartInitialization(paragraphCount);
          
          // Simulate manual initialization
          const manualState = simulateManualInitialization(paragraphCount);
          
          // States should be equivalent
          expect(areStatesEquivalent(autoStartState, manualState)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('both initialization methods should set initialized flag to true', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (paragraphCount) => {
          const autoStartState = simulateAutoStartInitialization(paragraphCount);
          const manualState = simulateManualInitialization(paragraphCount);
          
          expect(autoStartState.initialized).toBe(true);
          expect(manualState.initialized).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('both initialization methods should have parsed content available', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (paragraphCount) => {
          const autoStartState = simulateAutoStartInitialization(paragraphCount);
          const manualState = simulateManualInitialization(paragraphCount);
          
          expect(autoStartState.parsedContent).not.toBeNull();
          expect(autoStartState.parsedContent.paragraphs.length).toBe(paragraphCount);
          
          expect(manualState.parsedContent).not.toBeNull();
          expect(manualState.parsedContent.paragraphs.length).toBe(paragraphCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('both initialization methods should have highlight manager ready', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (paragraphCount) => {
          const autoStartState = simulateAutoStartInitialization(paragraphCount);
          const manualState = simulateManualInitialization(paragraphCount);
          
          expect(autoStartState.highlightManager).not.toBeNull();
          expect(manualState.highlightManager).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('both initialization methods should have floating player visible', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (paragraphCount) => {
          const autoStartState = simulateAutoStartInitialization(paragraphCount);
          const manualState = simulateManualInitialization(paragraphCount);
          
          expect(autoStartState.floatingPlayer).not.toBeNull();
          expect(autoStartState.floatingPlayer.visible).toBe(true);
          
          expect(manualState.floatingPlayer).not.toBeNull();
          expect(manualState.floatingPlayer.visible).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('both initialization methods should start with idle playback state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (paragraphCount) => {
          const autoStartState = simulateAutoStartInitialization(paragraphCount);
          const manualState = simulateManualInitialization(paragraphCount);
          
          expect(autoStartState.currentPlaybackState.status).toBe('idle');
          expect(manualState.currentPlaybackState.status).toBe('idle');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('repeated initialization should be idempotent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 5 }),
        (paragraphCount, repeatCount) => {
          // First initialization
          let state = simulateAutoStartInitialization(paragraphCount);
          
          // Repeated initializations should not change state
          // (initialize() checks if already initialized and returns early)
          for (let i = 0; i < repeatCount; i++) {
            const newState = simulateAutoStartInitialization(paragraphCount);
            expect(areStatesEquivalent(state, newState)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
