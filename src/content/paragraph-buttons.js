// ElevenPage Reader - Paragraph Buttons
// Injects play buttons next to paragraphs for navigation

/**
 * CSS class for paragraph buttons
 */
const BUTTON_CLASS = 'elevenlabs-paragraph-button';

/**
 * CSS class for paragraph wrapper
 */
const WRAPPER_CLASS = 'elevenlabs-paragraph-wrapper';

/**
 * Data attribute for paragraph index
 */
const PARAGRAPH_INDEX_ATTR = 'data-paragraph-index';

/**
 * Message types (matching service-worker.js)
 */
const MessageType = {
  STOP: 'stop',
  JUMP_TO_PARAGRAPH: 'jumpToParagraph'
};

/**
 * Store references to injected buttons and wrappers for cleanup
 */
let injectedButtons = [];
let injectedWrappers = [];

/**
 * Reference to paragraphs data for click handlers
 */
let paragraphsData = null;

/**
 * Creates a play button element
 * @param {number} paragraphIndex - Index of the paragraph
 * @returns {HTMLButtonElement} The button element
 */
function createButton(paragraphIndex) {
  const button = document.createElement('button');
  button.className = BUTTON_CLASS;
  button.setAttribute(PARAGRAPH_INDEX_ATTR, String(paragraphIndex));
  button.setAttribute('type', 'button');
  button.setAttribute('aria-label', `Play paragraph ${paragraphIndex + 1}`);
  button.setAttribute('title', 'Play from here');
  
  // Play icon (SVG)
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M8 5v14l11-7z"/>
    </svg>
  `;
  
  return button;
}

/**
 * Handles button click - sends message to service worker
 * @param {Event} event - Click event
 */
async function handleButtonClick(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const button = event.currentTarget;
  const paragraphIndex = parseInt(button.getAttribute(PARAGRAPH_INDEX_ATTR), 10);
  
  if (isNaN(paragraphIndex) || !paragraphsData || !paragraphsData[paragraphIndex]) {
    console.error('ElevenPage Reader: Invalid paragraph index');
    return;
  }
  
  const paragraph = paragraphsData[paragraphIndex];
  
  // Get the text content of the paragraph
  const text = paragraph.sentences.map(s => s.text).join(' ');
  
  if (!text || text.trim().length === 0) {
    console.error('ElevenPage Reader: No text content in paragraph');
    return;
  }
  
  try {
    // Send message to service worker to jump to this paragraph
    const response = await chrome.runtime.sendMessage({
      type: MessageType.JUMP_TO_PARAGRAPH,
      payload: {
        paragraphIndex,
        text
      }
    });
    
    if (!response.success) {
      console.error('ElevenPage Reader: Failed to start playback:', response.error);
    }
  } catch (error) {
    console.error('ElevenPage Reader: Error sending message:', error);
  }
}

/**
 * Injects play buttons next to each paragraph
 * @param {Array} paragraphs - Array of paragraph objects from text parser
 * @returns {HTMLButtonElement[]} Array of injected button elements
 */
function injectButtons(paragraphs) {
  if (!paragraphs || !Array.isArray(paragraphs)) {
    return [];
  }
  
  // Store reference for click handlers
  paragraphsData = paragraphs;
  
  // Clean up any existing buttons first
  removeButtons();
  
  const buttons = [];
  
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    
    if (!paragraph || !paragraph.element) {
      continue;
    }
    
    const element = paragraph.element;
    
    // Create wrapper to position button relative to paragraph
    const wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS;
    wrapper.setAttribute(PARAGRAPH_INDEX_ATTR, String(i));
    
    // Insert wrapper before the paragraph
    element.parentNode.insertBefore(wrapper, element);
    
    // Move paragraph into wrapper
    wrapper.appendChild(element);
    
    // Create and add button
    const button = createButton(i);
    button.addEventListener('click', handleButtonClick);
    
    // Insert button at the beginning of wrapper (before paragraph)
    wrapper.insertBefore(button, element);
    
    buttons.push(button);
    injectedButtons.push(button);
    injectedWrappers.push(wrapper);
  }
  
  return buttons;
}

/**
 * Removes all injected buttons and restores original DOM structure
 */
function removeButtons() {
  // Remove event listeners and buttons
  for (const button of injectedButtons) {
    button.removeEventListener('click', handleButtonClick);
    button.remove();
  }
  
  // Unwrap paragraphs from wrappers
  for (const wrapper of injectedWrappers) {
    const paragraph = wrapper.querySelector('p, [data-elevenlabs-processed]');
    if (paragraph && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(paragraph, wrapper);
      wrapper.remove();
    }
  }
  
  // Clear references
  injectedButtons = [];
  injectedWrappers = [];
  paragraphsData = null;
}

/**
 * Gets the number of currently injected buttons
 * @returns {number} Number of buttons
 */
function getButtonCount() {
  return injectedButtons.length;
}

/**
 * Gets all injected button elements
 * @returns {HTMLButtonElement[]} Array of button elements
 */
function getButtons() {
  return [...injectedButtons];
}

// Export for use in other modules
export {
  injectButtons,
  removeButtons,
  getButtonCount,
  getButtons,
  BUTTON_CLASS,
  WRAPPER_CLASS,
  PARAGRAPH_INDEX_ATTR
};
