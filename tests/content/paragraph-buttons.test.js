/**
 * Property-based tests for paragraph buttons module
 * 
 * Feature: elevenlabs-reader
 * Property 8: Paragraph Button Injection Completeness
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { JSDOM } from 'jsdom';

// Import the paragraph buttons module
import {
  injectButtons,
  removeButtons,
  getButtonCount,
  getButtons,
  BUTTON_CLASS,
  WRAPPER_CLASS,
  PARAGRAPH_INDEX_ATTR
} from '../../src/content/paragraph-buttons.js';

// Import text parser for creating paragraph structures
import {
  parsePageContent,
  escapeHtml
} from '../../src/content/text-parser.js';

/**
 * Helper to create a DOM document with paragraphs
 * @param {string[]} paragraphTexts - Array of paragraph text contents
 * @returns {Document} JSDOM document
 */
function createDocument(paragraphTexts) {
  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <main>
          ${paragraphTexts.map(text => `<p>${escapeHtml(text)}</p>`).join('\n')}
        </main>
      </body>
    </html>
  `;
  const dom = new JSDOM(html);
  return dom.window.document;
}

/**
 * Setup global document and chrome mock for tests
 */
function setupGlobals(doc) {
  global.document = doc;
  global.chrome = {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ success: true })
    }
  };
}

/**
 * Cleanup globals after tests
 */
function cleanupGlobals() {
  delete global.document;
  delete global.chrome;
}

describe('Paragraph Buttons Module - Property Tests', () => {
  
  afterEach(() => {
    // Clean up any injected buttons
    removeButtons();
    cleanupGlobals();
  });

  /**
   * Property 8: Paragraph Button Injection Completeness
   * For any page with N paragraphs containing readable text, the paragraph
   * button manager should inject exactly N paragraph buttons, one adjacent
   * to each paragraph.
   */
  describe('Property 8: Paragraph Button Injection Completeness', () => {
    
    it('should inject exactly one button per paragraph with readable text', () => {
      // Generate array of non-empty paragraph texts
      const paragraphArbitrary = fc.array(
        fc.stringOf(
          fc.char16bits().filter(c => /[a-zA-Z0-9 .,!?]/.test(c)),
          { minLength: 5, maxLength: 100 }
        ).filter(s => s.trim().length > 0),
        { minLength: 1, maxLength: 10 }
      );

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphTexts) => {
            // Create document and setup globals
            const doc = createDocument(paragraphTexts);
            setupGlobals(doc);
            
            // Parse the content
            const parsed = parsePageContent(doc);
            const paragraphCount = parsed.paragraphs.length;
            
            // Inject buttons
            const buttons = injectButtons(parsed.paragraphs);
            
            // Should have exactly one button per paragraph
            const injectedCount = getButtonCount();
            
            // Clean up for next iteration
            removeButtons();
            
            return injectedCount === paragraphCount && buttons.length === paragraphCount;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should inject buttons with correct paragraph indices', () => {
      const paragraphArbitrary = fc.array(
        fc.stringOf(
          fc.char16bits().filter(c => /[a-zA-Z0-9 .,!?]/.test(c)),
          { minLength: 5, maxLength: 50 }
        ).filter(s => s.trim().length > 0),
        { minLength: 1, maxLength: 8 }
      );

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphTexts) => {
            const doc = createDocument(paragraphTexts);
            setupGlobals(doc);
            
            const parsed = parsePageContent(doc);
            injectButtons(parsed.paragraphs);
            
            const buttons = getButtons();
            
            // Each button should have the correct paragraph index
            let allIndicesCorrect = true;
            for (let i = 0; i < buttons.length; i++) {
              const buttonIndex = parseInt(buttons[i].getAttribute(PARAGRAPH_INDEX_ATTR), 10);
              if (buttonIndex !== i) {
                allIndicesCorrect = false;
                break;
              }
            }
            
            removeButtons();
            
            return allIndicesCorrect;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should inject buttons adjacent to their respective paragraphs', () => {
      const paragraphArbitrary = fc.array(
        fc.stringOf(
          fc.char16bits().filter(c => /[a-zA-Z0-9 .,!?]/.test(c)),
          { minLength: 5, maxLength: 50 }
        ).filter(s => s.trim().length > 0),
        { minLength: 1, maxLength: 6 }
      );

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphTexts) => {
            const doc = createDocument(paragraphTexts);
            setupGlobals(doc);
            
            const parsed = parsePageContent(doc);
            injectButtons(parsed.paragraphs);
            
            // Each button should be inside a wrapper that contains its paragraph
            let allAdjacent = true;
            for (let i = 0; i < parsed.paragraphs.length; i++) {
              const paragraph = parsed.paragraphs[i].element;
              const wrapper = paragraph.parentElement;
              
              // Wrapper should have the wrapper class
              if (!wrapper || !wrapper.classList.contains(WRAPPER_CLASS)) {
                allAdjacent = false;
                break;
              }
              
              // Wrapper should contain a button with matching index
              const button = wrapper.querySelector(`.${BUTTON_CLASS}`);
              if (!button) {
                allAdjacent = false;
                break;
              }
              
              const buttonIndex = parseInt(button.getAttribute(PARAGRAPH_INDEX_ATTR), 10);
              if (buttonIndex !== i) {
                allAdjacent = false;
                break;
              }
            }
            
            removeButtons();
            
            return allAdjacent;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty paragraph array', () => {
      fc.assert(
        fc.property(
          fc.constant([]),
          (emptyArray) => {
            const doc = createDocument([]);
            setupGlobals(doc);
            
            const buttons = injectButtons(emptyArray);
            const count = getButtonCount();
            
            removeButtons();
            
            return buttons.length === 0 && count === 0;
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should remove all buttons when removeButtons is called', () => {
      const paragraphArbitrary = fc.array(
        fc.stringOf(
          fc.char16bits().filter(c => /[a-zA-Z0-9 .,!?]/.test(c)),
          { minLength: 5, maxLength: 50 }
        ).filter(s => s.trim().length > 0),
        { minLength: 1, maxLength: 8 }
      );

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphTexts) => {
            const doc = createDocument(paragraphTexts);
            setupGlobals(doc);
            
            const parsed = parsePageContent(doc);
            injectButtons(parsed.paragraphs);
            
            // Verify buttons were injected
            const countBefore = getButtonCount();
            
            // Remove buttons
            removeButtons();
            
            // Verify all buttons removed
            const countAfter = getButtonCount();
            const buttonsInDom = doc.querySelectorAll(`.${BUTTON_CLASS}`).length;
            const wrappersInDom = doc.querySelectorAll(`.${WRAPPER_CLASS}`).length;
            
            return countBefore > 0 && countAfter === 0 && buttonsInDom === 0 && wrappersInDom === 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Button Properties', () => {
    
    it('should create buttons with correct accessibility attributes', () => {
      const paragraphArbitrary = fc.array(
        fc.stringOf(
          fc.char16bits().filter(c => /[a-zA-Z0-9 .,!?]/.test(c)),
          { minLength: 5, maxLength: 50 }
        ).filter(s => s.trim().length > 0),
        { minLength: 1, maxLength: 5 }
      );

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphTexts) => {
            const doc = createDocument(paragraphTexts);
            setupGlobals(doc);
            
            const parsed = parsePageContent(doc);
            injectButtons(parsed.paragraphs);
            
            const buttons = getButtons();
            
            // Each button should have proper accessibility attributes
            let allAccessible = true;
            for (const button of buttons) {
              if (!button.hasAttribute('aria-label') ||
                  !button.hasAttribute('title') ||
                  button.getAttribute('type') !== 'button') {
                allAccessible = false;
                break;
              }
            }
            
            removeButtons();
            
            return allAccessible;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should create buttons with the correct CSS class', () => {
      const paragraphArbitrary = fc.array(
        fc.stringOf(
          fc.char16bits().filter(c => /[a-zA-Z0-9 .,!?]/.test(c)),
          { minLength: 5, maxLength: 50 }
        ).filter(s => s.trim().length > 0),
        { minLength: 1, maxLength: 5 }
      );

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphTexts) => {
            const doc = createDocument(paragraphTexts);
            setupGlobals(doc);
            
            const parsed = parsePageContent(doc);
            injectButtons(parsed.paragraphs);
            
            const buttons = getButtons();
            
            // Each button should have the correct class
            const allHaveClass = buttons.every(btn => btn.classList.contains(BUTTON_CLASS));
            
            removeButtons();
            
            return allHaveClass;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
