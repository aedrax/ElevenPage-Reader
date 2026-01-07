// ElevenPage Reader - Text Parser
// Extracts and prepares text content for TTS and highlighting

/**
 * CSS class prefix for wrapped word spans
 */
const WORD_SPAN_CLASS = 'elevenlabs-word';

/**
 * Data attribute for word index
 */
const WORD_INDEX_ATTR = 'data-word-index';

/**
 * Data attribute for sentence index
 */
const SENTENCE_INDEX_ATTR = 'data-sentence-index';

/**
 * Data attribute for paragraph index
 */
const PARAGRAPH_INDEX_ATTR = 'data-paragraph-index';

/**
 * Marker attribute to identify processed paragraphs
 */
const PROCESSED_ATTR = 'data-elevenlabs-processed';

/**
 * Parsed content structure
 * @typedef {Object} ParsedContent
 * @property {Paragraph[]} paragraphs - Array of parsed paragraphs
 */

/**
 * Paragraph structure
 * @typedef {Object} Paragraph
 * @property {HTMLElement} element - The paragraph DOM element
 * @property {Sentence[]} sentences - Array of sentences in the paragraph
 * @property {string} originalHTML - Original HTML content for restoration
 */

/**
 * Sentence structure
 * @typedef {Object} Sentence
 * @property {string} text - The sentence text
 * @property {Word[]} words - Array of words in the sentence
 * @property {number} startIndex - Character start index in paragraph
 * @property {number} endIndex - Character end index in paragraph
 */

/**
 * Word structure
 * @typedef {Object} Word
 * @property {string} text - The word text
 * @property {HTMLSpanElement|null} spanElement - The span element wrapping the word
 * @property {number} charStartIndex - Character start index in sentence
 * @property {number} charEndIndex - Character end index in sentence
 */

/**
 * Selectors for paragraph-like elements
 * Includes headings, list items, and other block-level text elements
 */
const PARAGRAPH_SELECTORS = [
  // Headings
  'article h1', 'article h2', 'article h3', 'article h4', 'article h5', 'article h6',
  'main h1', 'main h2', 'main h3', 'main h4', 'main h5', 'main h6',
  '.content h1', '.content h2', '.content h3', '.content h4', '.content h5', '.content h6',
  '.markdown-body h1', '.markdown-body h2', '.markdown-body h3', '.markdown-body h4', '.markdown-body h5', '.markdown-body h6',
  // List items
  'article li',
  'main li',
  '.content li',
  '.markdown-body li',
  '.post-content li',
  '.entry-content li',
  '.article-body li',
  // Paragraphs (most specific first)
  'article p',
  'main p',
  '.content p',
  '.markdown-body p',
  '.post-content p',
  '.entry-content p',
  '.article-body p',
  // Fallback generic selectors
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li',
  'p'
];

/**
 * Elements to exclude from parsing
 */
const EXCLUDED_SELECTORS = [
  'script',
  'style',
  'noscript',
  'nav',
  'header',
  'footer',
  'aside',
  '.sidebar',
  '.navigation',
  '.menu',
  '.comments',
  '.advertisement',
  '.ad'
];

/**
 * Splits text into sentences using common sentence-ending punctuation
 * @param {string} text - Text to split into sentences
 * @returns {string[]} Array of sentences
 */
function splitIntoSentences(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  // Match sentences ending with . ! ? followed by space or end of string
  // Also handles abbreviations and decimal numbers somewhat
  const sentenceRegex = /[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g;
  const matches = text.match(sentenceRegex);
  
  if (!matches) {
    return text.trim() ? [text.trim()] : [];
  }
  
  return matches
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Splits text into words
 * @param {string} text - Text to split into words
 * @returns {string[]} Array of words
 */
function splitIntoWords(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  // Split on whitespace, keeping punctuation attached to words
  return text.split(/\s+/).filter(w => w.length > 0);
}

/**
 * Checks if an element should be excluded from parsing
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if element should be excluded
 */
function shouldExcludeElement(element) {
  if (!element || !element.tagName) {
    return true;
  }
  
  // Check if element matches any excluded selector
  for (const selector of EXCLUDED_SELECTORS) {
    try {
      if (element.matches(selector) || element.closest(selector)) {
        return true;
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }
  
  return false;
}

/**
 * Gets the text content of an element, normalized
 * Filters out aria-hidden elements (like KaTeX math duplicates) and visually hidden elements
 * @param {HTMLElement} element - Element to get text from
 * @returns {string} Normalized text content
 */
function getTextContent(element) {
  if (!element) {
    return '';
  }
  
  // Clone the element to avoid modifying the original DOM
  const clone = element.cloneNode(true);
  
  // Remove elements that should not be read aloud:
  // - aria-hidden="true" (KaTeX math visual duplicates, icons, etc.)
  // - .cdk-visually-hidden (Angular CDK screen reader only text)
  // - .sr-only, .visually-hidden (common screen reader only classes)
  const hiddenSelectors = [
    '[aria-hidden="true"]',
    '.cdk-visually-hidden',
    '.sr-only',
    '.visually-hidden',
    'sup.superscript' // Footnote markers in Gemini
  ];
  
  for (const selector of hiddenSelectors) {
    const hiddenElements = clone.querySelectorAll(selector);
    for (const hidden of hiddenElements) {
      hidden.remove();
    }
  }
  
  const text = clone.textContent || '';
  // Normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parses page content and extracts paragraphs
 * @param {Document} [doc=document] - Document to parse (defaults to current document)
 * @returns {ParsedContent} Parsed content with paragraphs
 */
function parsePageContent(doc = document) {
  const paragraphs = [];
  const seenElements = new Set();
  
  // Try each selector in order of specificity
  for (const selector of PARAGRAPH_SELECTORS) {
    try {
      const elements = doc.querySelectorAll(selector);
      
      for (const element of elements) {
        // Skip if already processed or should be excluded
        if (seenElements.has(element)) {
          continue;
        }
        
        if (shouldExcludeElement(element)) {
          continue;
        }
        
        const text = getTextContent(element);
        
        // Skip empty paragraphs
        if (!text) {
          continue;
        }
        
        seenElements.add(element);
        
        const sentences = parseSentences(text);
        
        paragraphs.push({
          element,
          sentences,
          originalHTML: element.innerHTML
        });
      }
    } catch (e) {
      // Invalid selector, skip
      console.warn('ElevenPage Reader: Invalid selector', selector, e);
    }
  }
  
  return { paragraphs };
}

/**
 * Parses text into sentence structures
 * @param {string} text - Text to parse
 * @returns {Sentence[]} Array of sentence structures
 */
function parseSentences(text) {
  const sentenceTexts = splitIntoSentences(text);
  const sentences = [];
  let charIndex = 0;
  
  for (const sentenceText of sentenceTexts) {
    const startIndex = text.indexOf(sentenceText, charIndex);
    const endIndex = startIndex + sentenceText.length;
    
    const words = parseWords(sentenceText);
    
    sentences.push({
      text: sentenceText,
      words,
      startIndex: startIndex >= 0 ? startIndex : charIndex,
      endIndex: startIndex >= 0 ? endIndex : charIndex + sentenceText.length
    });
    
    charIndex = endIndex;
  }
  
  return sentences;
}

/**
 * Parses text into word structures
 * @param {string} text - Text to parse
 * @returns {Word[]} Array of word structures
 */
function parseWords(text) {
  const wordTexts = splitIntoWords(text);
  const words = [];
  let charIndex = 0;
  
  for (const wordText of wordTexts) {
    const startIndex = text.indexOf(wordText, charIndex);
    const endIndex = startIndex + wordText.length;
    
    words.push({
      text: wordText,
      spanElement: null,
      charStartIndex: startIndex >= 0 ? startIndex : charIndex,
      charEndIndex: startIndex >= 0 ? endIndex : charIndex + wordText.length
    });
    
    charIndex = endIndex;
  }
  
  return words;
}

/**
 * Wraps words in a paragraph element with span elements for highlighting
 * @param {HTMLElement} element - Paragraph element to process
 * @param {number} paragraphIndex - Index of the paragraph
 * @param {Sentence[]} sentences - Parsed sentences for the paragraph
 * @returns {Word[]} Array of words with their span elements
 */
function wrapWordsInSpans(element, paragraphIndex, sentences) {
  if (!element || !sentences || sentences.length === 0) {
    return [];
  }
  
  // Mark as processed
  element.setAttribute(PROCESSED_ATTR, 'true');
  element.setAttribute(PARAGRAPH_INDEX_ATTR, String(paragraphIndex));
  
  const allWords = [];
  let html = '';
  
  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
    const sentence = sentences[sentenceIndex];
    
    // Wrap sentence in a span
    html += `<span class="elevenlabs-sentence" ${SENTENCE_INDEX_ATTR}="${sentenceIndex}">`;
    
    for (let wordIndex = 0; wordIndex < sentence.words.length; wordIndex++) {
      const word = sentence.words[wordIndex];
      
      // Add space before word (except first word)
      if (wordIndex > 0) {
        html += ' ';
      }
      
      // Wrap word in a span
      const wordId = `elevenlabs-word-${paragraphIndex}-${sentenceIndex}-${wordIndex}`;
      html += `<span class="${WORD_SPAN_CLASS}" id="${wordId}" ${WORD_INDEX_ATTR}="${wordIndex}" ${SENTENCE_INDEX_ATTR}="${sentenceIndex}" ${PARAGRAPH_INDEX_ATTR}="${paragraphIndex}">${escapeHtml(word.text)}</span>`;
      
      allWords.push(word);
    }
    
    html += '</span>';
    
    // Add space between sentences
    if (sentenceIndex < sentences.length - 1) {
      html += ' ';
    }
  }
  
  // Replace element content
  element.innerHTML = html;
  
  // Update word references to actual span elements
  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
    const sentence = sentences[sentenceIndex];
    
    for (let wordIndex = 0; wordIndex < sentence.words.length; wordIndex++) {
      const wordId = `elevenlabs-word-${paragraphIndex}-${sentenceIndex}-${wordIndex}`;
      const spanElement = element.querySelector(`#${wordId}`);
      sentence.words[wordIndex].spanElement = spanElement;
    }
  }
  
  return allWords;
}

/**
 * Escapes HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (div) {
    div.textContent = text;
    return div.innerHTML;
  }
  // Fallback for non-browser environments
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Restores original content of a paragraph
 * @param {Paragraph} paragraph - Paragraph to restore
 */
function restoreOriginalContent(paragraph) {
  if (!paragraph || !paragraph.element || !paragraph.originalHTML) {
    return;
  }
  
  paragraph.element.innerHTML = paragraph.originalHTML;
  paragraph.element.removeAttribute(PROCESSED_ATTR);
  paragraph.element.removeAttribute(PARAGRAPH_INDEX_ATTR);
  
  // Clear span references
  for (const sentence of paragraph.sentences) {
    for (const word of sentence.words) {
      word.spanElement = null;
    }
  }
}

/**
 * Restores all paragraphs to their original content
 * @param {ParsedContent} parsedContent - Parsed content to restore
 */
function restoreAllContent(parsedContent) {
  if (!parsedContent || !parsedContent.paragraphs) {
    return;
  }
  
  for (const paragraph of parsedContent.paragraphs) {
    restoreOriginalContent(paragraph);
  }
}

/**
 * Gets the full text of all paragraphs for TTS
 * @param {ParsedContent} parsedContent - Parsed content
 * @returns {string} Full text content
 */
function getFullText(parsedContent) {
  if (!parsedContent || !parsedContent.paragraphs) {
    return '';
  }
  
  return parsedContent.paragraphs
    .map(p => p.sentences.map(s => s.text).join(' '))
    .join('\n\n');
}

/**
 * Gets text for a specific paragraph
 * @param {Paragraph} paragraph - Paragraph to get text from
 * @returns {string} Paragraph text
 */
function getParagraphText(paragraph) {
  if (!paragraph || !paragraph.sentences) {
    return '';
  }
  
  return paragraph.sentences.map(s => s.text).join(' ');
}

// Export for use in other modules
export {
  parsePageContent,
  wrapWordsInSpans,
  restoreOriginalContent,
  restoreAllContent,
  getFullText,
  getParagraphText,
  splitIntoSentences,
  splitIntoWords,
  getTextContent,
  escapeHtml,
  WORD_SPAN_CLASS,
  WORD_INDEX_ATTR,
  SENTENCE_INDEX_ATTR,
  PARAGRAPH_INDEX_ATTR,
  PROCESSED_ATTR
};
