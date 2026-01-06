// ElevenPage Reader - Highlight Manager
// Manages visual highlighting synchronized with audio playback

import {
  WORD_SPAN_CLASS,
  WORD_INDEX_ATTR,
  SENTENCE_INDEX_ATTR,
  PARAGRAPH_INDEX_ATTR
} from './text-parser.js';

/**
 * CSS class for sentence highlight
 */
const SENTENCE_HIGHLIGHT_CLASS = 'elevenlabs-sentence-highlight';

/**
 * CSS class for word highlight
 */
const WORD_HIGHLIGHT_CLASS = 'elevenlabs-word-highlight';

/**
 * Highlight Manager class
 * Manages sentence and word highlighting during audio playback
 */
class HighlightManager {
  constructor() {
    /** @type {ParsedContent|null} */
    this.parsedContent = null;
    
    /** @type {HTMLElement|null} */
    this.currentSentenceElement = null;
    
    /** @type {HTMLElement|null} */
    this.currentWordElement = null;
    
    /** @type {number} */
    this.currentParagraphIndex = -1;
    
    /** @type {number} */
    this.currentSentenceIndex = -1;
    
    /** @type {number} */
    this.currentWordIndex = -1;
  }

  /**
   * Sets the parsed content for highlighting
   * @param {ParsedContent} parsedContent - Parsed page content
   */
  setParsedContent(parsedContent) {
    this.parsedContent = parsedContent;
  }

  /**
   * Highlights a sentence at the given indices
   * @param {number} paragraphIndex - Index of the paragraph
   * @param {number} sentenceIndex - Index of the sentence within the paragraph
   */
  highlightSentence(paragraphIndex, sentenceIndex) {
    // Remove previous sentence highlight
    if (this.currentSentenceElement) {
      this.currentSentenceElement.classList.remove(SENTENCE_HIGHLIGHT_CLASS);
    }

    // Find the sentence element
    const sentenceElement = this._findSentenceElement(paragraphIndex, sentenceIndex);
    
    if (sentenceElement) {
      sentenceElement.classList.add(SENTENCE_HIGHLIGHT_CLASS);
      this.currentSentenceElement = sentenceElement;
      this.currentParagraphIndex = paragraphIndex;
      this.currentSentenceIndex = sentenceIndex;
      
      // Scroll sentence into view if needed
      this._scrollIntoViewIfNeeded(sentenceElement);
    }
  }

  /**
   * Highlights a word at the given indices
   * @param {number} paragraphIndex - Index of the paragraph
   * @param {number} sentenceIndex - Index of the sentence within the paragraph
   * @param {number} wordIndex - Index of the word within the sentence
   */
  highlightWord(paragraphIndex, sentenceIndex, wordIndex) {
    // Remove previous word highlight
    if (this.currentWordElement) {
      this.currentWordElement.classList.remove(WORD_HIGHLIGHT_CLASS);
    }

    // Find the word element
    const wordElement = this._findWordElement(paragraphIndex, sentenceIndex, wordIndex);
    
    if (wordElement) {
      wordElement.classList.add(WORD_HIGHLIGHT_CLASS);
      this.currentWordElement = wordElement;
      this.currentWordIndex = wordIndex;
      
      // Also update sentence highlight if needed
      if (paragraphIndex !== this.currentParagraphIndex || 
          sentenceIndex !== this.currentSentenceIndex) {
        this.highlightSentence(paragraphIndex, sentenceIndex);
      }
    }
  }

  /**
   * Clears all highlights from the page
   */
  clearHighlights() {
    // Remove sentence highlight
    if (this.currentSentenceElement) {
      this.currentSentenceElement.classList.remove(SENTENCE_HIGHLIGHT_CLASS);
      this.currentSentenceElement = null;
    }

    // Remove word highlight
    if (this.currentWordElement) {
      this.currentWordElement.classList.remove(WORD_HIGHLIGHT_CLASS);
      this.currentWordElement = null;
    }

    // Also clear any stray highlights (in case of state mismatch)
    const allSentenceHighlights = document.querySelectorAll(`.${SENTENCE_HIGHLIGHT_CLASS}`);
    allSentenceHighlights.forEach(el => el.classList.remove(SENTENCE_HIGHLIGHT_CLASS));

    const allWordHighlights = document.querySelectorAll(`.${WORD_HIGHLIGHT_CLASS}`);
    allWordHighlights.forEach(el => el.classList.remove(WORD_HIGHLIGHT_CLASS));

    // Reset indices
    this.currentParagraphIndex = -1;
    this.currentSentenceIndex = -1;
    this.currentWordIndex = -1;
  }

  /**
   * Updates highlights based on current audio timestamp and alignment data
   * @param {number} currentTime - Current audio playback time in seconds
   * @param {AlignmentData} alignmentData - Alignment data from ElevenLabs API
   * @param {number} [paragraphOffset=0] - Starting paragraph index for the current audio
   */
  updateFromTimestamp(currentTime, alignmentData, paragraphOffset = 0) {
    if (!alignmentData || !this.parsedContent) {
      return;
    }

    const position = this._findPositionFromTimestamp(currentTime, alignmentData, paragraphOffset);
    
    if (position) {
      this.highlightWord(position.paragraphIndex, position.sentenceIndex, position.wordIndex);
    }
  }

  /**
   * Finds the word position from a timestamp using alignment data
   * @param {number} currentTime - Current audio time in seconds
   * @param {AlignmentData} alignmentData - Alignment data from ElevenLabs
   * @param {number} paragraphOffset - Starting paragraph index
   * @returns {{paragraphIndex: number, sentenceIndex: number, wordIndex: number}|null}
   * @private
   */
  _findPositionFromTimestamp(currentTime, alignmentData, paragraphOffset) {
    if (!alignmentData || !alignmentData.characters || 
        !alignmentData.character_start_times_seconds) {
      return null;
    }

    const { characters, character_start_times_seconds, character_end_times_seconds } = alignmentData;
    
    // Find the character index at the current time
    let charIndex = -1;
    for (let i = 0; i < character_start_times_seconds.length; i++) {
      const startTime = character_start_times_seconds[i];
      const endTime = character_end_times_seconds ? character_end_times_seconds[i] : 
                      (i + 1 < character_start_times_seconds.length ? 
                       character_start_times_seconds[i + 1] : startTime + 0.1);
      
      if (currentTime >= startTime && currentTime < endTime) {
        charIndex = i;
        break;
      }
    }

    if (charIndex < 0) {
      // If past all characters, use the last one
      if (currentTime >= character_start_times_seconds[character_start_times_seconds.length - 1]) {
        charIndex = characters.length - 1;
      } else {
        return null;
      }
    }

    // Map character index to word position
    return this._mapCharIndexToWordPosition(charIndex, characters, paragraphOffset);
  }

  /**
   * Maps a character index to paragraph/sentence/word position
   * @param {number} charIndex - Character index in the alignment data
   * @param {string[]} characters - Array of characters from alignment data
   * @param {number} paragraphOffset - Starting paragraph index
   * @returns {{paragraphIndex: number, sentenceIndex: number, wordIndex: number}|null}
   * @private
   */
  _mapCharIndexToWordPosition(charIndex, characters, paragraphOffset) {
    if (!this.parsedContent || !this.parsedContent.paragraphs) {
      return null;
    }

    // Build the text from characters up to charIndex to find position
    const textUpToChar = characters.slice(0, charIndex + 1).join('');
    
    let globalCharCount = 0;
    
    for (let pIdx = paragraphOffset; pIdx < this.parsedContent.paragraphs.length; pIdx++) {
      const paragraph = this.parsedContent.paragraphs[pIdx];
      
      for (let sIdx = 0; sIdx < paragraph.sentences.length; sIdx++) {
        const sentence = paragraph.sentences[sIdx];
        
        for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
          const word = sentence.words[wIdx];
          const wordEnd = globalCharCount + word.text.length;
          
          // Check if charIndex falls within this word
          if (charIndex >= globalCharCount && charIndex < wordEnd) {
            return {
              paragraphIndex: pIdx,
              sentenceIndex: sIdx,
              wordIndex: wIdx
            };
          }
          
          // Add word length plus space
          globalCharCount = wordEnd + 1;
        }
      }
      
      // Add paragraph separator
      globalCharCount += 1;
    }

    return null;
  }

  /**
   * Finds a sentence element by indices
   * @param {number} paragraphIndex - Paragraph index
   * @param {number} sentenceIndex - Sentence index
   * @returns {HTMLElement|null}
   * @private
   */
  _findSentenceElement(paragraphIndex, sentenceIndex) {
    // Try to find via parsed content first
    if (this.parsedContent && this.parsedContent.paragraphs[paragraphIndex]) {
      const paragraph = this.parsedContent.paragraphs[paragraphIndex];
      const sentenceSpan = paragraph.element.querySelector(
        `.elevenlabs-sentence[${SENTENCE_INDEX_ATTR}="${sentenceIndex}"]`
      );
      if (sentenceSpan) {
        return sentenceSpan;
      }
    }

    // Fallback to DOM query
    const selector = `[${PARAGRAPH_INDEX_ATTR}="${paragraphIndex}"] .elevenlabs-sentence[${SENTENCE_INDEX_ATTR}="${sentenceIndex}"]`;
    return document.querySelector(selector);
  }

  /**
   * Finds a word element by indices
   * @param {number} paragraphIndex - Paragraph index
   * @param {number} sentenceIndex - Sentence index
   * @param {number} wordIndex - Word index
   * @returns {HTMLElement|null}
   * @private
   */
  _findWordElement(paragraphIndex, sentenceIndex, wordIndex) {
    // Try to find via parsed content first
    if (this.parsedContent && 
        this.parsedContent.paragraphs[paragraphIndex] &&
        this.parsedContent.paragraphs[paragraphIndex].sentences[sentenceIndex] &&
        this.parsedContent.paragraphs[paragraphIndex].sentences[sentenceIndex].words[wordIndex]) {
      const word = this.parsedContent.paragraphs[paragraphIndex].sentences[sentenceIndex].words[wordIndex];
      if (word.spanElement) {
        return word.spanElement;
      }
    }

    // Fallback to DOM query using ID
    const wordId = `elevenlabs-word-${paragraphIndex}-${sentenceIndex}-${wordIndex}`;
    return document.getElementById(wordId);
  }

  /**
   * Scrolls an element into view if it's not visible
   * @param {HTMLElement} element - Element to scroll into view
   * @private
   */
  _scrollIntoViewIfNeeded(element) {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const isVisible = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );

    if (!isVisible) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }

  /**
   * Gets the current highlight state
   * @returns {{paragraphIndex: number, sentenceIndex: number, wordIndex: number}}
   */
  getCurrentState() {
    return {
      paragraphIndex: this.currentParagraphIndex,
      sentenceIndex: this.currentSentenceIndex,
      wordIndex: this.currentWordIndex
    };
  }
}

// Export for use in other modules
export {
  HighlightManager,
  SENTENCE_HIGHLIGHT_CLASS,
  WORD_HIGHLIGHT_CLASS
};
