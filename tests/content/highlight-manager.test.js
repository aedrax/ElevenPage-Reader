/**
 * Property-based tests for highlight manager module
 * 
 * Feature: elevenlabs-reader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { JSDOM } from 'jsdom';

// Import the highlight manager module
import {
  HighlightManager,
  SENTENCE_HIGHLIGHT_CLASS,
  WORD_HIGHLIGHT_CLASS
} from '../../src/content/highlight-manager.js';

// Import text parser for creating test content
import {
  parsePageContent,
  wrapWordsInSpans,
  escapeHtml
} from '../../src/content/text-parser.js';

/**
 * Helper to create a DOM document with paragraphs
 * @param {string[]} paragraphTexts - Array of paragraph text contents
 * @returns {{dom: JSDOM, document: Document}} JSDOM instance and document
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
  return { dom, document: dom.window.document };
}

/**
 * Helper to set up a document with parsed and wrapped content
 * @param {string[]} paragraphTexts - Array of paragraph text contents
 * @returns {{dom: JSDOM, document: Document, parsedContent: ParsedContent, highlightManager: HighlightManager}}
 */
function setupTestEnvironment(paragraphTexts) {
  const { dom, document } = createDocument(paragraphTexts);
  
  // Set up global document for highlight manager
  global.document = document;
  global.window = dom.window;
  
  // Parse content
  const parsedContent = parsePageContent(document);
  
  // Wrap words in spans for each paragraph
  parsedContent.paragraphs.forEach((paragraph, index) => {
    wrapWordsInSpans(paragraph.element, index, paragraph.sentences);
  });
  
  // Create highlight manager
  const highlightManager = new HighlightManager();
  highlightManager.setParsedContent(parsedContent);
  
  return { dom, document, parsedContent, highlightManager };
}

/**
 * Arbitrary for generating valid paragraph text
 */
const validParagraphTextArbitrary = fc.array(
  fc.stringOf(fc.char16bits().filter(c => /[a-zA-Z0-9]/.test(c)), { minLength: 1, maxLength: 15 }),
  { minLength: 1, maxLength: 10 }
).map(words => words.join(' ') + '.');

/**
 * Arbitrary for generating multiple sentences
 */
const multipleSentencesArbitrary = fc.array(
  fc.array(
    fc.stringOf(fc.char16bits().filter(c => /[a-zA-Z0-9]/.test(c)), { minLength: 1, maxLength: 10 }),
    { minLength: 2, maxLength: 6 }
  ).map(words => words.join(' ') + '.'),
  { minLength: 2, maxLength: 4 }
).map(sentences => sentences.join(' '));

describe('Highlight Manager Module - Property Tests', () => {
  
  afterEach(() => {
    // Clean up global document
    delete global.document;
    delete global.window;
  });

  /**
   * Property 6: Sentence Highlight Exclusivity
   * For any playback state where audio is playing, exactly one sentence should
   * have the sentence highlight class applied, and all other sentences should
   * not have the highlight class.
   */
  describe('Property 6: Sentence Highlight Exclusivity', () => {
    
    it('should highlight exactly one sentence at a time', () => {
      fc.assert(
        fc.property(
          // Generate multiple paragraphs with multiple sentences each
          fc.array(multipleSentencesArbitrary, { minLength: 1, maxLength: 3 }),
          // Generate random paragraph and sentence indices to highlight
          fc.nat({ max: 2 }),
          fc.nat({ max: 3 }),
          (paragraphTexts, paragraphIndexRaw, sentenceIndexRaw) => {
            const { document, parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            // Ensure indices are within bounds
            if (parsedContent.paragraphs.length === 0) {
              return true; // No content to test
            }
            
            const paragraphIndex = paragraphIndexRaw % parsedContent.paragraphs.length;
            const paragraph = parsedContent.paragraphs[paragraphIndex];
            
            if (paragraph.sentences.length === 0) {
              return true; // No sentences to test
            }
            
            const sentenceIndex = sentenceIndexRaw % paragraph.sentences.length;
            
            // Highlight the sentence
            highlightManager.highlightSentence(paragraphIndex, sentenceIndex);
            
            // Count highlighted sentences
            const highlightedSentences = document.querySelectorAll(`.${SENTENCE_HIGHLIGHT_CLASS}`);
            
            // Should have exactly one highlighted sentence
            return highlightedSentences.length === 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove previous sentence highlight when highlighting a new sentence', () => {
      fc.assert(
        fc.property(
          // Generate paragraphs with multiple sentences
          fc.array(multipleSentencesArbitrary, { minLength: 2, maxLength: 3 }),
          // Generate two different sentence positions to highlight sequentially
          fc.tuple(fc.nat({ max: 2 }), fc.nat({ max: 3 })),
          fc.tuple(fc.nat({ max: 2 }), fc.nat({ max: 3 })),
          (paragraphTexts, firstPos, secondPos) => {
            const { document, parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            if (parsedContent.paragraphs.length === 0) {
              return true;
            }
            
            // Calculate valid indices for first highlight
            const firstParagraphIndex = firstPos[0] % parsedContent.paragraphs.length;
            const firstParagraph = parsedContent.paragraphs[firstParagraphIndex];
            
            if (firstParagraph.sentences.length === 0) {
              return true;
            }
            
            const firstSentenceIndex = firstPos[1] % firstParagraph.sentences.length;
            
            // Calculate valid indices for second highlight
            const secondParagraphIndex = secondPos[0] % parsedContent.paragraphs.length;
            const secondParagraph = parsedContent.paragraphs[secondParagraphIndex];
            
            if (secondParagraph.sentences.length === 0) {
              return true;
            }
            
            const secondSentenceIndex = secondPos[1] % secondParagraph.sentences.length;
            
            // Highlight first sentence
            highlightManager.highlightSentence(firstParagraphIndex, firstSentenceIndex);
            
            // Highlight second sentence
            highlightManager.highlightSentence(secondParagraphIndex, secondSentenceIndex);
            
            // Count highlighted sentences - should still be exactly one
            const highlightedSentences = document.querySelectorAll(`.${SENTENCE_HIGHLIGHT_CLASS}`);
            
            return highlightedSentences.length === 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should clear all sentence highlights when clearHighlights is called', () => {
      fc.assert(
        fc.property(
          fc.array(multipleSentencesArbitrary, { minLength: 1, maxLength: 3 }),
          fc.nat({ max: 2 }),
          fc.nat({ max: 3 }),
          (paragraphTexts, paragraphIndexRaw, sentenceIndexRaw) => {
            const { document, parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            if (parsedContent.paragraphs.length === 0) {
              return true;
            }
            
            const paragraphIndex = paragraphIndexRaw % parsedContent.paragraphs.length;
            const paragraph = parsedContent.paragraphs[paragraphIndex];
            
            if (paragraph.sentences.length === 0) {
              return true;
            }
            
            const sentenceIndex = sentenceIndexRaw % paragraph.sentences.length;
            
            // Highlight a sentence
            highlightManager.highlightSentence(paragraphIndex, sentenceIndex);
            
            // Clear highlights
            highlightManager.clearHighlights();
            
            // Should have no highlighted sentences
            const highlightedSentences = document.querySelectorAll(`.${SENTENCE_HIGHLIGHT_CLASS}`);
            
            return highlightedSentences.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 7: Word Highlight Exclusivity
   * For any playback state where audio is playing with valid alignment data,
   * exactly one word should have the word highlight class applied, and all
   * other words should not have the highlight class.
   */
  describe('Property 7: Word Highlight Exclusivity', () => {
    
    it('should highlight exactly one word at a time', () => {
      fc.assert(
        fc.property(
          // Generate paragraphs with multiple words
          fc.array(validParagraphTextArbitrary, { minLength: 1, maxLength: 3 }),
          // Generate random indices for word to highlight
          fc.nat({ max: 2 }),
          fc.nat({ max: 3 }),
          fc.nat({ max: 9 }),
          (paragraphTexts, paragraphIndexRaw, sentenceIndexRaw, wordIndexRaw) => {
            const { document, parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            if (parsedContent.paragraphs.length === 0) {
              return true;
            }
            
            const paragraphIndex = paragraphIndexRaw % parsedContent.paragraphs.length;
            const paragraph = parsedContent.paragraphs[paragraphIndex];
            
            if (paragraph.sentences.length === 0) {
              return true;
            }
            
            const sentenceIndex = sentenceIndexRaw % paragraph.sentences.length;
            const sentence = paragraph.sentences[sentenceIndex];
            
            if (sentence.words.length === 0) {
              return true;
            }
            
            const wordIndex = wordIndexRaw % sentence.words.length;
            
            // Highlight the word
            highlightManager.highlightWord(paragraphIndex, sentenceIndex, wordIndex);
            
            // Count highlighted words
            const highlightedWords = document.querySelectorAll(`.${WORD_HIGHLIGHT_CLASS}`);
            
            // Should have exactly one highlighted word
            return highlightedWords.length === 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove previous word highlight when highlighting a new word', () => {
      fc.assert(
        fc.property(
          fc.array(validParagraphTextArbitrary, { minLength: 1, maxLength: 3 }),
          // Generate two different word positions
          fc.tuple(fc.nat({ max: 2 }), fc.nat({ max: 3 }), fc.nat({ max: 9 })),
          fc.tuple(fc.nat({ max: 2 }), fc.nat({ max: 3 }), fc.nat({ max: 9 })),
          (paragraphTexts, firstPos, secondPos) => {
            const { document, parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            if (parsedContent.paragraphs.length === 0) {
              return true;
            }
            
            // Calculate valid indices for first word
            const firstParagraphIndex = firstPos[0] % parsedContent.paragraphs.length;
            const firstParagraph = parsedContent.paragraphs[firstParagraphIndex];
            
            if (firstParagraph.sentences.length === 0) {
              return true;
            }
            
            const firstSentenceIndex = firstPos[1] % firstParagraph.sentences.length;
            const firstSentence = firstParagraph.sentences[firstSentenceIndex];
            
            if (firstSentence.words.length === 0) {
              return true;
            }
            
            const firstWordIndex = firstPos[2] % firstSentence.words.length;
            
            // Calculate valid indices for second word
            const secondParagraphIndex = secondPos[0] % parsedContent.paragraphs.length;
            const secondParagraph = parsedContent.paragraphs[secondParagraphIndex];
            
            if (secondParagraph.sentences.length === 0) {
              return true;
            }
            
            const secondSentenceIndex = secondPos[1] % secondParagraph.sentences.length;
            const secondSentence = secondParagraph.sentences[secondSentenceIndex];
            
            if (secondSentence.words.length === 0) {
              return true;
            }
            
            const secondWordIndex = secondPos[2] % secondSentence.words.length;
            
            // Highlight first word
            highlightManager.highlightWord(firstParagraphIndex, firstSentenceIndex, firstWordIndex);
            
            // Highlight second word
            highlightManager.highlightWord(secondParagraphIndex, secondSentenceIndex, secondWordIndex);
            
            // Count highlighted words - should still be exactly one
            const highlightedWords = document.querySelectorAll(`.${WORD_HIGHLIGHT_CLASS}`);
            
            return highlightedWords.length === 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should clear all word highlights when clearHighlights is called', () => {
      fc.assert(
        fc.property(
          fc.array(validParagraphTextArbitrary, { minLength: 1, maxLength: 3 }),
          fc.nat({ max: 2 }),
          fc.nat({ max: 3 }),
          fc.nat({ max: 9 }),
          (paragraphTexts, paragraphIndexRaw, sentenceIndexRaw, wordIndexRaw) => {
            const { document, parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            if (parsedContent.paragraphs.length === 0) {
              return true;
            }
            
            const paragraphIndex = paragraphIndexRaw % parsedContent.paragraphs.length;
            const paragraph = parsedContent.paragraphs[paragraphIndex];
            
            if (paragraph.sentences.length === 0) {
              return true;
            }
            
            const sentenceIndex = sentenceIndexRaw % paragraph.sentences.length;
            const sentence = paragraph.sentences[sentenceIndex];
            
            if (sentence.words.length === 0) {
              return true;
            }
            
            const wordIndex = wordIndexRaw % sentence.words.length;
            
            // Highlight a word
            highlightManager.highlightWord(paragraphIndex, sentenceIndex, wordIndex);
            
            // Clear highlights
            highlightManager.clearHighlights();
            
            // Should have no highlighted words
            const highlightedWords = document.querySelectorAll(`.${WORD_HIGHLIGHT_CLASS}`);
            
            return highlightedWords.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should also update sentence highlight when highlighting a word in a different sentence', () => {
      fc.assert(
        fc.property(
          // Need at least 2 sentences to test cross-sentence highlighting
          fc.array(multipleSentencesArbitrary, { minLength: 1, maxLength: 2 }),
          fc.nat({ max: 1 }),
          fc.nat({ max: 3 }),
          fc.nat({ max: 5 }),
          (paragraphTexts, paragraphIndexRaw, sentenceIndexRaw, wordIndexRaw) => {
            const { document, parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            if (parsedContent.paragraphs.length === 0) {
              return true;
            }
            
            const paragraphIndex = paragraphIndexRaw % parsedContent.paragraphs.length;
            const paragraph = parsedContent.paragraphs[paragraphIndex];
            
            if (paragraph.sentences.length === 0) {
              return true;
            }
            
            const sentenceIndex = sentenceIndexRaw % paragraph.sentences.length;
            const sentence = paragraph.sentences[sentenceIndex];
            
            if (sentence.words.length === 0) {
              return true;
            }
            
            const wordIndex = wordIndexRaw % sentence.words.length;
            
            // Highlight a word (which should also highlight its sentence)
            highlightManager.highlightWord(paragraphIndex, sentenceIndex, wordIndex);
            
            // Should have exactly one highlighted sentence
            const highlightedSentences = document.querySelectorAll(`.${SENTENCE_HIGHLIGHT_CLASS}`);
            
            // Should have exactly one highlighted word
            const highlightedWords = document.querySelectorAll(`.${WORD_HIGHLIGHT_CLASS}`);
            
            return highlightedSentences.length === 1 && highlightedWords.length === 1;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Highlight Manager State', () => {
    
    it('should track current highlight state correctly', () => {
      fc.assert(
        fc.property(
          fc.array(validParagraphTextArbitrary, { minLength: 1, maxLength: 3 }),
          fc.nat({ max: 2 }),
          fc.nat({ max: 3 }),
          fc.nat({ max: 9 }),
          (paragraphTexts, paragraphIndexRaw, sentenceIndexRaw, wordIndexRaw) => {
            const { parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            if (parsedContent.paragraphs.length === 0) {
              return true;
            }
            
            const paragraphIndex = paragraphIndexRaw % parsedContent.paragraphs.length;
            const paragraph = parsedContent.paragraphs[paragraphIndex];
            
            if (paragraph.sentences.length === 0) {
              return true;
            }
            
            const sentenceIndex = sentenceIndexRaw % paragraph.sentences.length;
            const sentence = paragraph.sentences[sentenceIndex];
            
            if (sentence.words.length === 0) {
              return true;
            }
            
            const wordIndex = wordIndexRaw % sentence.words.length;
            
            // Highlight a word
            highlightManager.highlightWord(paragraphIndex, sentenceIndex, wordIndex);
            
            // Get current state
            const state = highlightManager.getCurrentState();
            
            // State should match what we highlighted
            return state.paragraphIndex === paragraphIndex &&
                   state.sentenceIndex === sentenceIndex &&
                   state.wordIndex === wordIndex;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reset state after clearHighlights', () => {
      fc.assert(
        fc.property(
          fc.array(validParagraphTextArbitrary, { minLength: 1, maxLength: 2 }),
          fc.nat({ max: 1 }),
          fc.nat({ max: 2 }),
          fc.nat({ max: 5 }),
          (paragraphTexts, paragraphIndexRaw, sentenceIndexRaw, wordIndexRaw) => {
            const { parsedContent, highlightManager } = setupTestEnvironment(paragraphTexts);
            
            if (parsedContent.paragraphs.length === 0) {
              return true;
            }
            
            const paragraphIndex = paragraphIndexRaw % parsedContent.paragraphs.length;
            const paragraph = parsedContent.paragraphs[paragraphIndex];
            
            if (paragraph.sentences.length === 0) {
              return true;
            }
            
            const sentenceIndex = sentenceIndexRaw % paragraph.sentences.length;
            const sentence = paragraph.sentences[sentenceIndex];
            
            if (sentence.words.length === 0) {
              return true;
            }
            
            const wordIndex = wordIndexRaw % sentence.words.length;
            
            // Highlight a word
            highlightManager.highlightWord(paragraphIndex, sentenceIndex, wordIndex);
            
            // Clear highlights
            highlightManager.clearHighlights();
            
            // Get current state
            const state = highlightManager.getCurrentState();
            
            // State should be reset
            return state.paragraphIndex === -1 &&
                   state.sentenceIndex === -1 &&
                   state.wordIndex === -1;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
