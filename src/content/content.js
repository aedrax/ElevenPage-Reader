// ElevenPage Reader - Content Script Entry Point
// Initializes text parser, highlight manager, paragraph buttons, and floating player
// Note: Content scripts in Manifest V3 don't support ES modules, so we inline dependencies

/**
 * Message types for communication with service worker
 */
const MessageType = {
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  SET_SPEED: 'setSpeed',
  JUMP_TO_PARAGRAPH: 'jumpToParagraph',
  GET_STATE: 'getState',
  HIGHLIGHT_UPDATE: 'highlightUpdate',
  PLAYBACK_STATE_CHANGE: 'playbackStateChange',
  GET_NEXT_PARAGRAPH: 'getNextParagraph',
  SET_TOTAL_PARAGRAPHS: 'setTotalParagraphs',
  SHOW_PLAYER: 'showPlayer'
};

/**
 * Playback status enum
 */
const PlaybackStatus = {
  IDLE: 'idle',
  LOADING: 'loading',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ERROR: 'error'
};

/**
 * Speed options for the speed control
 */
const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

// ============================================================================
// TEXT PARSER (inlined from text-parser.js)
// ============================================================================

const WORD_SPAN_CLASS = 'elevenlabs-word';
const WORD_INDEX_ATTR = 'data-word-index';
const SENTENCE_INDEX_ATTR = 'data-sentence-index';
const PARAGRAPH_INDEX_ATTR = 'data-paragraph-index';
const PROCESSED_ATTR = 'data-elevenlabs-processed';

const PARAGRAPH_SELECTORS = [
  'article p', 'main p', '.content p', '.post-content p',
  '.entry-content p', '.article-body p', 'p'
];

const EXCLUDED_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside',
  '.sidebar', '.navigation', '.menu', '.comments', '.advertisement', '.ad'
];


function splitIntoSentences(text) {
  if (!text || typeof text !== 'string') return [];
  const sentenceRegex = /[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g;
  const matches = text.match(sentenceRegex);
  if (!matches) return text.trim() ? [text.trim()] : [];
  return matches.map(s => s.trim()).filter(s => s.length > 0);
}

function splitIntoWords(text) {
  if (!text || typeof text !== 'string') return [];
  return text.split(/\s+/).filter(w => w.length > 0);
}

function shouldExcludeElement(element) {
  if (!element || !element.tagName) return true;
  for (const selector of EXCLUDED_SELECTORS) {
    try {
      if (element.matches(selector) || element.closest(selector)) return true;
    } catch (e) { /* skip */ }
  }
  return false;
}

function getTextContent(element) {
  if (!element) return '';
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
}

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


function parsePageContent(doc = document) {
  const paragraphs = [];
  const seenElements = new Set();
  for (const selector of PARAGRAPH_SELECTORS) {
    try {
      const elements = doc.querySelectorAll(selector);
      for (const element of elements) {
        if (seenElements.has(element) || shouldExcludeElement(element)) continue;
        const text = getTextContent(element);
        if (!text) continue;
        seenElements.add(element);
        paragraphs.push({
          element,
          sentences: parseSentences(text),
          originalHTML: element.innerHTML
        });
      }
    } catch (e) {
      console.warn('ElevenPage Reader: Invalid selector', selector, e);
    }
  }
  return { paragraphs };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function wrapWordsInSpans(element, paragraphIndex, sentences) {
  if (!element || !sentences || sentences.length === 0) return [];
  element.setAttribute(PROCESSED_ATTR, 'true');
  element.setAttribute(PARAGRAPH_INDEX_ATTR, String(paragraphIndex));
  const allWords = [];
  let html = '';
  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    const sentence = sentences[sIdx];
    html += `<span class="elevenlabs-sentence" ${SENTENCE_INDEX_ATTR}="${sIdx}">`;
    for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
      const word = sentence.words[wIdx];
      if (wIdx > 0) html += ' ';
      const wordId = `elevenlabs-word-${paragraphIndex}-${sIdx}-${wIdx}`;
      html += `<span class="${WORD_SPAN_CLASS}" id="${wordId}" ${WORD_INDEX_ATTR}="${wIdx}" ${SENTENCE_INDEX_ATTR}="${sIdx}" ${PARAGRAPH_INDEX_ATTR}="${paragraphIndex}">${escapeHtml(word.text)}</span>`;
      allWords.push(word);
    }
    html += '</span>';
    if (sIdx < sentences.length - 1) html += ' ';
  }
  element.innerHTML = html;
  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    for (let wIdx = 0; wIdx < sentences[sIdx].words.length; wIdx++) {
      const wordId = `elevenlabs-word-${paragraphIndex}-${sIdx}-${wIdx}`;
      sentences[sIdx].words[wIdx].spanElement = element.querySelector(`#${wordId}`);
    }
  }
  return allWords;
}


function restoreOriginalContent(paragraph) {
  if (!paragraph || !paragraph.element || !paragraph.originalHTML) return;
  paragraph.element.innerHTML = paragraph.originalHTML;
  paragraph.element.removeAttribute(PROCESSED_ATTR);
  paragraph.element.removeAttribute(PARAGRAPH_INDEX_ATTR);
  for (const sentence of paragraph.sentences) {
    for (const word of sentence.words) word.spanElement = null;
  }
}

function restoreAllContent(parsedContent) {
  if (!parsedContent || !parsedContent.paragraphs) return;
  for (const paragraph of parsedContent.paragraphs) restoreOriginalContent(paragraph);
}

// ============================================================================
// HIGHLIGHT MANAGER (inlined from highlight-manager.js)
// ============================================================================

const SENTENCE_HIGHLIGHT_CLASS = 'elevenlabs-sentence-highlight';
const WORD_HIGHLIGHT_CLASS = 'elevenlabs-word-highlight';

class HighlightManager {
  constructor() {
    this.parsedContent = null;
    this.currentSentenceElement = null;
    this.currentWordElement = null;
    this.currentParagraphIndex = -1;
    this.currentSentenceIndex = -1;
    this.currentWordIndex = -1;
  }

  setParsedContent(parsedContent) {
    this.parsedContent = parsedContent;
  }

  highlightSentence(paragraphIndex, sentenceIndex) {
    if (this.currentSentenceElement) {
      this.currentSentenceElement.classList.remove(SENTENCE_HIGHLIGHT_CLASS);
    }
    const sentenceElement = this._findSentenceElement(paragraphIndex, sentenceIndex);
    if (sentenceElement) {
      sentenceElement.classList.add(SENTENCE_HIGHLIGHT_CLASS);
      this.currentSentenceElement = sentenceElement;
      this.currentParagraphIndex = paragraphIndex;
      this.currentSentenceIndex = sentenceIndex;
      this._scrollIntoViewIfNeeded(sentenceElement);
    }
  }

  highlightWord(paragraphIndex, sentenceIndex, wordIndex) {
    if (this.currentWordElement) {
      this.currentWordElement.classList.remove(WORD_HIGHLIGHT_CLASS);
    }
    const wordElement = this._findWordElement(paragraphIndex, sentenceIndex, wordIndex);
    if (wordElement) {
      wordElement.classList.add(WORD_HIGHLIGHT_CLASS);
      this.currentWordElement = wordElement;
      this.currentWordIndex = wordIndex;
      if (paragraphIndex !== this.currentParagraphIndex || sentenceIndex !== this.currentSentenceIndex) {
        this.highlightSentence(paragraphIndex, sentenceIndex);
      }
    }
  }


  clearHighlights() {
    if (this.currentSentenceElement) {
      this.currentSentenceElement.classList.remove(SENTENCE_HIGHLIGHT_CLASS);
      this.currentSentenceElement = null;
    }
    if (this.currentWordElement) {
      this.currentWordElement.classList.remove(WORD_HIGHLIGHT_CLASS);
      this.currentWordElement = null;
    }
    document.querySelectorAll(`.${SENTENCE_HIGHLIGHT_CLASS}`).forEach(el => el.classList.remove(SENTENCE_HIGHLIGHT_CLASS));
    document.querySelectorAll(`.${WORD_HIGHLIGHT_CLASS}`).forEach(el => el.classList.remove(WORD_HIGHLIGHT_CLASS));
    this.currentParagraphIndex = -1;
    this.currentSentenceIndex = -1;
    this.currentWordIndex = -1;
  }

  updateFromTimestamp(currentTime, alignmentData, paragraphOffset = 0) {
    if (!alignmentData || !this.parsedContent) return;
    const position = this._findPositionFromTimestamp(currentTime, alignmentData, paragraphOffset);
    if (position) this.highlightWord(position.paragraphIndex, position.sentenceIndex, position.wordIndex);
  }

  _findPositionFromTimestamp(currentTime, alignmentData, paragraphOffset) {
    if (!alignmentData || !alignmentData.characters || !alignmentData.character_start_times_seconds) return null;
    const { characters, character_start_times_seconds, character_end_times_seconds } = alignmentData;
    let charIndex = -1;
    for (let i = 0; i < character_start_times_seconds.length; i++) {
      const startTime = character_start_times_seconds[i];
      const endTime = character_end_times_seconds ? character_end_times_seconds[i] : 
                      (i + 1 < character_start_times_seconds.length ? character_start_times_seconds[i + 1] : startTime + 0.1);
      if (currentTime >= startTime && currentTime < endTime) { charIndex = i; break; }
    }
    if (charIndex < 0) {
      if (currentTime >= character_start_times_seconds[character_start_times_seconds.length - 1]) {
        charIndex = characters.length - 1;
      } else return null;
    }
    return this._mapCharIndexToWordPosition(charIndex, characters, paragraphOffset);
  }

  _mapCharIndexToWordPosition(charIndex, characters, paragraphOffset) {
    if (!this.parsedContent || !this.parsedContent.paragraphs) return null;
    let globalCharCount = 0;
    for (let pIdx = paragraphOffset; pIdx < this.parsedContent.paragraphs.length; pIdx++) {
      const paragraph = this.parsedContent.paragraphs[pIdx];
      for (let sIdx = 0; sIdx < paragraph.sentences.length; sIdx++) {
        const sentence = paragraph.sentences[sIdx];
        for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
          const word = sentence.words[wIdx];
          const wordEnd = globalCharCount + word.text.length;
          if (charIndex >= globalCharCount && charIndex < wordEnd) {
            return { paragraphIndex: pIdx, sentenceIndex: sIdx, wordIndex: wIdx };
          }
          globalCharCount = wordEnd + 1;
        }
      }
      globalCharCount += 1;
    }
    return null;
  }


  _findSentenceElement(paragraphIndex, sentenceIndex) {
    if (this.parsedContent && this.parsedContent.paragraphs[paragraphIndex]) {
      const paragraph = this.parsedContent.paragraphs[paragraphIndex];
      const sentenceSpan = paragraph.element.querySelector(`.elevenlabs-sentence[${SENTENCE_INDEX_ATTR}="${sentenceIndex}"]`);
      if (sentenceSpan) return sentenceSpan;
    }
    return document.querySelector(`[${PARAGRAPH_INDEX_ATTR}="${paragraphIndex}"] .elevenlabs-sentence[${SENTENCE_INDEX_ATTR}="${sentenceIndex}"]`);
  }

  _findWordElement(paragraphIndex, sentenceIndex, wordIndex) {
    if (this.parsedContent && this.parsedContent.paragraphs[paragraphIndex] &&
        this.parsedContent.paragraphs[paragraphIndex].sentences[sentenceIndex] &&
        this.parsedContent.paragraphs[paragraphIndex].sentences[sentenceIndex].words[wordIndex]) {
      const word = this.parsedContent.paragraphs[paragraphIndex].sentences[sentenceIndex].words[wordIndex];
      if (word.spanElement) return word.spanElement;
    }
    return document.getElementById(`elevenlabs-word-${paragraphIndex}-${sentenceIndex}-${wordIndex}`);
  }

  _scrollIntoViewIfNeeded(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const isVisible = rect.top >= 0 && rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth);
    if (!isVisible) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  getCurrentState() {
    return {
      paragraphIndex: this.currentParagraphIndex,
      sentenceIndex: this.currentSentenceIndex,
      wordIndex: this.currentWordIndex
    };
  }
}

// ============================================================================
// PARAGRAPH BUTTONS (inlined from paragraph-buttons.js)
// ============================================================================

const BUTTON_CLASS = 'elevenlabs-paragraph-button';
const WRAPPER_CLASS = 'elevenlabs-paragraph-wrapper';
let injectedButtons = [];
let injectedWrappers = [];
let paragraphsData = null;


function createParagraphButton(paragraphIndex) {
  const button = document.createElement('button');
  button.className = BUTTON_CLASS;
  button.setAttribute(PARAGRAPH_INDEX_ATTR, String(paragraphIndex));
  button.setAttribute('type', 'button');
  button.setAttribute('aria-label', `Play paragraph ${paragraphIndex + 1}`);
  button.setAttribute('title', 'Play from here');
  button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>`;
  return button;
}

async function handleParagraphButtonClick(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  const paragraphIndex = parseInt(button.getAttribute(PARAGRAPH_INDEX_ATTR), 10);
  if (isNaN(paragraphIndex) || !paragraphsData || !paragraphsData[paragraphIndex]) {
    console.error('ElevenPage Reader: Invalid paragraph index');
    return;
  }
  const paragraph = paragraphsData[paragraphIndex];
  const text = paragraph.sentences.map(s => s.text).join(' ');
  if (!text || text.trim().length === 0) {
    console.error('ElevenPage Reader: No text content in paragraph');
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.JUMP_TO_PARAGRAPH,
      payload: { paragraphIndex, text }
    });
    if (!response.success) console.error('ElevenPage Reader: Failed to start playback:', response.error);
  } catch (error) {
    console.error('ElevenPage Reader: Error sending message:', error);
  }
}

function injectButtons(paragraphs) {
  if (!paragraphs || !Array.isArray(paragraphs)) return [];
  removeButtons();
  paragraphsData = paragraphs;
  const buttons = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    if (!paragraph || !paragraph.element) continue;
    const element = paragraph.element;
    const wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS;
    wrapper.setAttribute(PARAGRAPH_INDEX_ATTR, String(i));
    element.parentNode.insertBefore(wrapper, element);
    wrapper.appendChild(element);
    const button = createParagraphButton(i);
    button.addEventListener('click', handleParagraphButtonClick);
    wrapper.insertBefore(button, element);
    buttons.push(button);
    injectedButtons.push(button);
    injectedWrappers.push(wrapper);
  }
  return buttons;
}

function removeButtons() {
  for (const button of injectedButtons) {
    button.removeEventListener('click', handleParagraphButtonClick);
    button.remove();
  }
  for (const wrapper of injectedWrappers) {
    const paragraph = wrapper.querySelector('p, [data-elevenlabs-processed]');
    if (paragraph && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(paragraph, wrapper);
      wrapper.remove();
    }
  }
  injectedButtons = [];
  injectedWrappers = [];
  paragraphsData = null;
}


// ============================================================================
// FLOATING PLAYER (inlined from floating-player.js)
// ============================================================================

class FloatingPlayer {
  constructor() {
    this.container = null;
    this.playPauseButton = null;
    this.stopButton = null;
    this.speedSelect = null;
    this.statusText = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.position = { x: 20, y: 20 };
    this.currentState = { status: PlaybackStatus.IDLE, speed: 1.0 };
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onPlayPauseClick = this.onPlayPauseClick.bind(this);
    this.onStopClick = this.onStopClick.bind(this);
    this.onSpeedChange = this.onSpeedChange.bind(this);
  }

  createPlayerElement() {
    const container = document.createElement('div');
    container.className = 'elevenlabs-floating-player';
    container.id = 'elevenlabs-floating-player';
    
    const header = document.createElement('div');
    header.className = 'elevenlabs-fp-header';
    const title = document.createElement('span');
    title.className = 'elevenlabs-fp-title';
    title.textContent = 'ElevenPage Reader';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'elevenlabs-fp-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Hide player';
    closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(closeBtn);
    container.appendChild(header);
    
    const controls = document.createElement('div');
    controls.className = 'elevenlabs-fp-controls';
    this.playPauseButton = document.createElement('button');
    this.playPauseButton.className = 'elevenlabs-fp-btn elevenlabs-fp-play-pause';
    this.playPauseButton.innerHTML = this.getPlayIcon();
    this.playPauseButton.title = 'Play';
    this.playPauseButton.addEventListener('click', this.onPlayPauseClick);
    controls.appendChild(this.playPauseButton);
    
    this.stopButton = document.createElement('button');
    this.stopButton.className = 'elevenlabs-fp-btn elevenlabs-fp-stop';
    this.stopButton.innerHTML = this.getStopIcon();
    this.stopButton.title = 'Stop';
    this.stopButton.addEventListener('click', this.onStopClick);
    controls.appendChild(this.stopButton);
    
    const speedContainer = document.createElement('div');
    speedContainer.className = 'elevenlabs-fp-speed-container';
    const speedLabel = document.createElement('label');
    speedLabel.className = 'elevenlabs-fp-speed-label';
    speedLabel.textContent = 'Speed:';
    speedContainer.appendChild(speedLabel);
    this.speedSelect = document.createElement('select');
    this.speedSelect.className = 'elevenlabs-fp-speed-select';
    this.speedSelect.title = 'Playback speed';
    SPEED_OPTIONS.forEach(speed => {
      const option = document.createElement('option');
      option.value = speed.toString();
      option.textContent = `${speed}x`;
      if (speed === 1.0) option.selected = true;
      this.speedSelect.appendChild(option);
    });
    this.speedSelect.addEventListener('change', this.onSpeedChange);
    speedContainer.appendChild(this.speedSelect);
    controls.appendChild(speedContainer);
    container.appendChild(controls);
    
    this.statusText = document.createElement('div');
    this.statusText.className = 'elevenlabs-fp-status';
    this.statusText.textContent = 'Ready';
    container.appendChild(this.statusText);
    return container;
  }


  getPlayIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5-9-5.5z"/></svg>`;
  }
  getPauseIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2h4v12H3V2zm6 0h4v12H9V2z"/></svg>`;
  }
  getStopIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10"/></svg>`;
  }

  show() {
    if (this.container) { this.container.style.display = 'block'; return; }
    this.container = this.createPlayerElement();
    document.body.appendChild(this.container);
    this.setPosition(this.position.x, this.position.y);
    this.enableDrag();
    this.syncState();
  }

  hide() { if (this.container) this.container.style.display = 'none'; }

  destroy() {
    if (this.container) {
      document.removeEventListener('mousemove', this.onMouseMove);
      document.removeEventListener('mouseup', this.onMouseUp);
      this.container.remove();
      this.container = null;
      this.playPauseButton = null;
      this.stopButton = null;
      this.speedSelect = null;
      this.statusText = null;
    }
  }

  isVisible() { return this.container && this.container.style.display !== 'none'; }

  setPosition(x, y) {
    this.position = { x, y };
    if (this.container) { this.container.style.left = `${x}px`; this.container.style.top = `${y}px`; }
  }

  enableDrag() {
    if (!this.container) return;
    const header = this.container.querySelector('.elevenlabs-fp-header');
    if (header) header.addEventListener('mousedown', this.onMouseDown);
  }

  onMouseDown(e) {
    if (e.target.classList.contains('elevenlabs-fp-close')) return;
    this.isDragging = true;
    this.dragOffset = { x: e.clientX - this.position.x, y: e.clientY - this.position.y };
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    e.preventDefault();
  }

  onMouseMove(e) {
    if (!this.isDragging) return;
    const newX = e.clientX - this.dragOffset.x;
    const newY = e.clientY - this.dragOffset.y;
    const maxX = window.innerWidth - (this.container?.offsetWidth || 200);
    const maxY = window.innerHeight - (this.container?.offsetHeight || 100);
    this.setPosition(Math.max(0, Math.min(newX, maxX)), Math.max(0, Math.min(newY, maxY)));
  }

  onMouseUp() {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }


  async onPlayPauseClick() {
    const status = this.currentState.status;
    if (status === PlaybackStatus.PLAYING) {
      await sendMessage({ type: MessageType.PAUSE });
    } else if (status === PlaybackStatus.PAUSED) {
      await sendMessage({ type: MessageType.PLAY, payload: {} });
    }
  }

  async onStopClick() { await sendMessage({ type: MessageType.STOP }); }

  async onSpeedChange(e) {
    const speed = parseFloat(e.target.value);
    await sendMessage({ type: MessageType.SET_SPEED, payload: { speed } });
  }

  async syncState() {
    const response = await sendMessage({ type: MessageType.GET_STATE });
    if (response && response.success && response.state) this.updatePlaybackState(response.state);
  }

  updatePlaybackState(playbackState) {
    this.currentState = playbackState;
    if (this.playPauseButton) {
      if (playbackState.status === PlaybackStatus.PLAYING) {
        this.playPauseButton.innerHTML = this.getPauseIcon();
        this.playPauseButton.title = 'Pause';
      } else {
        this.playPauseButton.innerHTML = this.getPlayIcon();
        this.playPauseButton.title = 'Play';
      }
      this.playPauseButton.disabled = playbackState.status === PlaybackStatus.IDLE || playbackState.status === PlaybackStatus.LOADING;
    }
    if (this.stopButton) this.stopButton.disabled = playbackState.status === PlaybackStatus.IDLE;
    if (this.statusText) {
      switch (playbackState.status) {
        case PlaybackStatus.IDLE: this.statusText.textContent = 'Ready - Click a paragraph to start'; break;
        case PlaybackStatus.LOADING: this.statusText.textContent = 'Loading...'; break;
        case PlaybackStatus.PLAYING: this.statusText.textContent = 'Playing'; break;
        case PlaybackStatus.PAUSED: this.statusText.textContent = 'Paused'; break;
        case PlaybackStatus.ERROR: this.statusText.textContent = `Error: ${playbackState.error || 'Unknown error'}`; break;
        default: this.statusText.textContent = 'Ready';
      }
    }
  }

  updateSpeed(speed) {
    this.currentState.speed = speed;
    if (this.speedSelect) this.speedSelect.value = speed.toString();
  }
}

// ============================================================================
// CONTENT SCRIPT STATE AND MAIN LOGIC
// ============================================================================

let contentState = {
  initialized: false,
  parsedContent: null,
  highlightManager: null,
  floatingPlayer: null,
  currentPlaybackState: { status: PlaybackStatus.IDLE, speed: 1.0 }
};


async function sendMessage(message) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
    } else {
      resolve({});
    }
  });
}

async function initialize() {
  if (contentState.initialized) {
    console.log('ElevenPage Reader: Already initialized');
    return;
  }
  console.log('ElevenPage Reader: Initializing content script');
  try {
    contentState.parsedContent = parsePageContent(document);
    if (!contentState.parsedContent || contentState.parsedContent.paragraphs.length === 0) {
      console.log('ElevenPage Reader: No readable content found on page');
      return;
    }
    console.log(`ElevenPage Reader: Found ${contentState.parsedContent.paragraphs.length} paragraphs`);
    
    // Send total paragraphs count to service worker for auto-continue boundary checking
    const totalParagraphs = contentState.parsedContent.paragraphs.length;
    await sendMessage({ 
      type: MessageType.SET_TOTAL_PARAGRAPHS, 
      payload: { totalParagraphs } 
    });
    
    for (let i = 0; i < contentState.parsedContent.paragraphs.length; i++) {
      const paragraph = contentState.parsedContent.paragraphs[i];
      wrapWordsInSpans(paragraph.element, i, paragraph.sentences);
    }
    
    contentState.highlightManager = new HighlightManager();
    contentState.highlightManager.setParsedContent(contentState.parsedContent);
    injectButtons(contentState.parsedContent.paragraphs);
    contentState.floatingPlayer = new FloatingPlayer();
    contentState.floatingPlayer.show();
    
    const response = await sendMessage({ type: MessageType.GET_STATE });
    if (response && response.success && response.state) {
      contentState.currentPlaybackState = response.state;
      contentState.floatingPlayer.updatePlaybackState(response.state);
      if (response.state.speed) contentState.floatingPlayer.updateSpeed(response.state.speed);
    }
    
    contentState.initialized = true;
    console.log('ElevenPage Reader: Content script initialized successfully');
  } catch (error) {
    console.error('ElevenPage Reader: Error initializing content script:', error);
  }
}

/**
 * Clean up all content script resources
 * Called on page navigation or unload
 */
function cleanup() {
  console.log('ElevenPage Reader: Cleaning up content script');
  
  // Clear all highlights
  if (contentState.highlightManager) {
    contentState.highlightManager.clearHighlights();
    contentState.highlightManager = null;
  }
  
  // Remove paragraph buttons
  removeButtons();
  
  // Destroy floating player
  if (contentState.floatingPlayer) {
    contentState.floatingPlayer.destroy();
    contentState.floatingPlayer = null;
  }
  
  // Restore original page content
  if (contentState.parsedContent) {
    restoreAllContent(contentState.parsedContent);
    contentState.parsedContent = null;
  }
  
  // Reset state
  contentState.initialized = false;
  contentState.currentPlaybackState = { status: PlaybackStatus.IDLE, speed: 1.0 };
}


function handleHighlightUpdate(message) {
  if (!contentState.highlightManager || !contentState.parsedContent) return;
  const { currentTime, alignment, paragraphIndex } = message;
  if (alignment && typeof currentTime === 'number') {
    contentState.highlightManager.updateFromTimestamp(currentTime, alignment, paragraphIndex || 0);
  }
}

/**
 * Handle GET_NEXT_PARAGRAPH message from service worker
 * Returns the text content and index of the requested paragraph
 * @param {Object} message - Message containing paragraphIndex
 * @returns {Object} Response with success, text, paragraphIndex, or error
 */
function handleGetNextParagraph(message) {
  const { paragraphIndex } = message;
  
  // Validate that we have parsed content
  if (!contentState.parsedContent || !contentState.parsedContent.paragraphs) {
    return { success: false, error: 'No parsed content available' };
  }
  
  const paragraphs = contentState.parsedContent.paragraphs;
  
  // Validate paragraph index
  if (typeof paragraphIndex !== 'number' || paragraphIndex < 0 || paragraphIndex >= paragraphs.length) {
    return { success: false, error: 'Invalid paragraph index' };
  }
  
  const paragraph = paragraphs[paragraphIndex];
  
  // Extract text from paragraph sentences
  const text = paragraph.sentences.map(s => s.text).join(' ');
  
  if (!text || text.trim().length === 0) {
    return { success: false, error: 'Paragraph has no text content' };
  }
  
  return { success: true, text, paragraphIndex };
}

function handlePlaybackStateChange(message) {
  const { state: playbackState } = message;
  if (!playbackState) return;
  
  // Update local state
  contentState.currentPlaybackState = playbackState;
  
  // Update floating player UI on state change
  if (contentState.floatingPlayer) {
    contentState.floatingPlayer.updatePlaybackState(playbackState);
    if (playbackState.speed) {
      contentState.floatingPlayer.updateSpeed(playbackState.speed);
    }
  }
  
  // Clear highlights when playback stops
  if (playbackState.status === PlaybackStatus.IDLE && contentState.highlightManager) {
    contentState.highlightManager.clearHighlights();
  }
  
  console.log('ElevenPage Reader: State synchronized -', playbackState.status);
}

function setupMessageListener() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case MessageType.HIGHLIGHT_UPDATE:
          handleHighlightUpdate(message);
          sendResponse({ received: true });
          break;
        case MessageType.PLAYBACK_STATE_CHANGE:
          handlePlaybackStateChange(message);
          sendResponse({ received: true });
          break;
        case MessageType.GET_NEXT_PARAGRAPH:
          const response = handleGetNextParagraph(message);
          sendResponse(response);
          break;
        case MessageType.SHOW_PLAYER:
          if (contentState.floatingPlayer) {
            contentState.floatingPlayer.show();
          }
          sendResponse({ success: true });
          break;
        default:
          sendResponse({ received: true });
      }
      return true;
    });
  }
}

function setupVisibilityListener() {
  document.addEventListener('visibilitychange', () => {
    // Optionally pause when tab becomes hidden
  });
}

/**
 * Setup listener for page unload/navigation
 * Stops playback and cleans up resources when user navigates away
 */
function setupUnloadListener() {
  // Handle page unload (closing tab or navigating away)
  window.addEventListener('beforeunload', () => {
    // Stop playback if currently playing or paused
    if (contentState.currentPlaybackState.status !== PlaybackStatus.IDLE) {
      // Use synchronous approach for beforeunload
      try {
        sendMessage({ type: MessageType.STOP });
      } catch (e) {
        // Ignore errors during unload
      }
    }
    cleanup();
  });
  
  // Handle page hide (for bfcache scenarios)
  window.addEventListener('pagehide', (event) => {
    if (contentState.currentPlaybackState.status !== PlaybackStatus.IDLE) {
      sendMessage({ type: MessageType.STOP });
    }
    // Only cleanup if page is not being cached
    if (!event.persisted) {
      cleanup();
    }
  });
}

// Initialize
setupMessageListener();
setupVisibilityListener();
setupUnloadListener();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

console.log('ElevenPage Reader content script loaded');
