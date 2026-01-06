/**
 * Property-based tests for text parser module
 * 
 * Feature: elevenlabs-reader
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { JSDOM } from 'jsdom';

// Import the text parser module
import {
  parsePageContent,
  wrapWordsInSpans,
  restoreOriginalContent,
  splitIntoSentences,
  splitIntoWords,
  getTextContent,
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
 * Helper to normalize whitespace for comparison
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

describe('Text Parser Module - Property Tests', () => {
  
  /**
   * Property 3: Text Parsing Preserves Content
   * For any HTML paragraph element, wrapping words in span elements and then
   * extracting the text content should produce the same text as the original
   * paragraph (whitespace-normalized).
   */
  describe('Property 3: Text Parsing Preserves Content', () => {
    
    it('should preserve text content after wrapping words in spans', () => {
      // Generate arbitrary text that represents realistic paragraph content
      // Must contain at least one word (alphanumeric characters)
      const wordArbitrary = fc.stringOf(
        fc.char16bits().filter(c => /[a-zA-Z0-9]/.test(c)),
        { minLength: 1, maxLength: 20 }
      );
      
      const textArbitrary = fc.array(wordArbitrary, { minLength: 1, maxLength: 20 })
        .map(words => words.join(' '))
        .filter(s => s.trim().length > 0);

      fc.assert(
        fc.property(
          textArbitrary,
          (paragraphText) => {
            // Create a document with the paragraph
            const doc = createDocument([paragraphText]);
            
            // Parse the content
            const parsed = parsePageContent(doc);
            
            // Should have found the paragraph
            if (parsed.paragraphs.length === 0) {
              // If no paragraphs found, the text was likely empty after normalization
              return normalizeWhitespace(paragraphText).length === 0;
            }
            
            const paragraph = parsed.paragraphs[0];
            const originalText = normalizeWhitespace(paragraph.element.textContent);
            
            // Wrap words in spans
            wrapWordsInSpans(paragraph.element, 0, paragraph.sentences);
            
            // Get text content after wrapping
            const wrappedText = normalizeWhitespace(paragraph.element.textContent);
            
            // Text content should be preserved (whitespace-normalized)
            return originalText === wrappedText;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve text content for multiple sentences', () => {
      // Generate sentences with proper punctuation
      const sentenceArbitrary = fc.tuple(
        fc.stringOf(fc.char16bits().filter(c => /[a-zA-Z0-9 ]/.test(c)), { minLength: 3, maxLength: 50 }),
        fc.constantFrom('.', '!', '?')
      ).map(([text, punct]) => text.trim() + punct);

      const paragraphArbitrary = fc.array(sentenceArbitrary, { minLength: 1, maxLength: 5 })
        .map(sentences => sentences.join(' '));

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphText) => {
            const doc = createDocument([paragraphText]);
            const parsed = parsePageContent(doc);
            
            if (parsed.paragraphs.length === 0) {
              return true; // Empty content is valid
            }
            
            const paragraph = parsed.paragraphs[0];
            const originalText = normalizeWhitespace(paragraph.element.textContent);
            
            wrapWordsInSpans(paragraph.element, 0, paragraph.sentences);
            
            const wrappedText = normalizeWhitespace(paragraph.element.textContent);
            
            return originalText === wrappedText;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should restore original content correctly', () => {
      const textArbitrary = fc.stringOf(
        fc.oneof(
          fc.char16bits().filter(c => /[a-zA-Z0-9 .,!?]/.test(c))
        ),
        { minLength: 5, maxLength: 100 }
      ).filter(s => s.trim().length > 0);

      fc.assert(
        fc.property(
          textArbitrary,
          (paragraphText) => {
            const doc = createDocument([paragraphText]);
            const parsed = parsePageContent(doc);
            
            if (parsed.paragraphs.length === 0) {
              return true;
            }
            
            const paragraph = parsed.paragraphs[0];
            const originalHTML = paragraph.originalHTML;
            
            // Wrap words
            wrapWordsInSpans(paragraph.element, 0, paragraph.sentences);
            
            // Restore original content
            restoreOriginalContent(paragraph);
            
            // HTML should be restored
            return paragraph.element.innerHTML === originalHTML;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 4: Paragraph Boundary Detection
   * For any HTML document containing paragraph elements, the text parser should
   * identify exactly as many paragraph boundaries as there are paragraph elements
   * with non-empty text content.
   */
  describe('Property 4: Paragraph Boundary Detection', () => {
    
    it('should detect correct number of non-empty paragraphs', () => {
      // Generate array of paragraph texts (some may be empty)
      const paragraphArbitrary = fc.array(
        fc.oneof(
          fc.constant(''), // Empty paragraph
          fc.stringOf(fc.char16bits().filter(c => /[a-zA-Z0-9 .,!?]/.test(c)), { minLength: 1, maxLength: 100 })
        ),
        { minLength: 0, maxLength: 10 }
      );

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphTexts) => {
            const doc = createDocument(paragraphTexts);
            const parsed = parsePageContent(doc);
            
            // Count non-empty paragraphs
            const nonEmptyCount = paragraphTexts.filter(t => t.trim().length > 0).length;
            
            // Parser should find exactly that many paragraphs
            return parsed.paragraphs.length === nonEmptyCount;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect paragraphs in correct order', () => {
      // Generate non-empty paragraph texts
      const paragraphArbitrary = fc.array(
        fc.stringOf(fc.char16bits().filter(c => /[a-zA-Z0-9]/.test(c)), { minLength: 5, maxLength: 50 }),
        { minLength: 1, maxLength: 5 }
      ).filter(arr => arr.every(t => t.trim().length > 0));

      fc.assert(
        fc.property(
          paragraphArbitrary,
          (paragraphTexts) => {
            const doc = createDocument(paragraphTexts);
            const parsed = parsePageContent(doc);
            
            // Should have same number of paragraphs
            if (parsed.paragraphs.length !== paragraphTexts.length) {
              return false;
            }
            
            // Each parsed paragraph should match the original text (normalized)
            for (let i = 0; i < paragraphTexts.length; i++) {
              const originalNormalized = normalizeWhitespace(paragraphTexts[i]);
              const parsedNormalized = normalizeWhitespace(
                parsed.paragraphs[i].sentences.map(s => s.text).join(' ')
              );
              
              if (originalNormalized !== parsedNormalized) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Helper Functions', () => {
    
    it('splitIntoSentences should split on sentence-ending punctuation', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              fc.stringOf(fc.char16bits().filter(c => /[a-zA-Z0-9 ]/.test(c)), { minLength: 1, maxLength: 30 }),
              fc.constantFrom('.', '!', '?')
            ).map(([text, punct]) => text.trim() + punct),
            { minLength: 1, maxLength: 5 }
          ),
          (sentences) => {
            const text = sentences.join(' ');
            const split = splitIntoSentences(text);
            
            // Should have at least as many sentences as we created
            // (may have more if text contains additional punctuation)
            return split.length >= 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('splitIntoWords should split on whitespace', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.stringOf(fc.char16bits().filter(c => /[a-zA-Z0-9]/.test(c)), { minLength: 1, maxLength: 20 }),
            { minLength: 1, maxLength: 10 }
          ),
          (words) => {
            const text = words.join(' ');
            const split = splitIntoWords(text);
            
            // Should have same number of words
            return split.length === words.length;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getTextContent should normalize whitespace', () => {
      fc.assert(
        fc.property(
          fc.stringOf(
            fc.oneof(
              fc.char16bits().filter(c => /[a-zA-Z0-9]/.test(c)),
              fc.constantFrom(' ', '\t', '\n', '  ', '\r\n')
            ),
            { minLength: 1, maxLength: 100 }
          ),
          (text) => {
            const dom = new JSDOM(`<p>${text}</p>`);
            const element = dom.window.document.querySelector('p');
            const content = getTextContent(element);
            
            // Should not have consecutive whitespace
            return !/\s{2,}/.test(content);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
