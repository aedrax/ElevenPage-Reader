// ElevenPage Reader - Content Script Entry Point
// This file is bundled by esbuild into dist/content.js

import {
  parsePageContent,
  wrapWordsInSpans,
  restoreAllContent,
  PARAGRAPH_INDEX_ATTR
} from './text-parser.js';

import { HighlightManager } from './highlight-manager.js';
import { injectButtons, removeButtons } from './paragraph-buttons.js';
import { FloatingPlayer, MessageType, PlaybackStatus } from './floating-player.js';

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

/**
 * Wait for content to be available on dynamically-rendered pages (SPAs like Angular, React)
 * Retries parsing with exponential backoff, or uses MutationObserver as fallback
 */
async function waitForContent(maxAttempts = 5, initialDelay = 500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const parsed = parsePageContent(document);
    if (parsed && parsed.paragraphs.length > 0) {
      console.log(`ElevenPage Reader: Found content on attempt ${attempt}`);
      return parsed;
    }
    
    if (attempt < maxAttempts) {
      const delay = initialDelay * attempt;
      console.log(`ElevenPage Reader: No content found, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Final fallback: wait for DOM mutations that might indicate content loading
  return new Promise((resolve) => {
    console.log('ElevenPage Reader: Using MutationObserver to wait for content...');
    let resolved = false;
    
    const observer = new MutationObserver(() => {
      if (resolved) return;
      const parsed = parsePageContent(document);
      if (parsed && parsed.paragraphs.length > 0) {
        resolved = true;
        observer.disconnect();
        console.log('ElevenPage Reader: Found content via MutationObserver');
        resolve(parsed);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        console.log('ElevenPage Reader: Timeout waiting for content');
        resolve(null);
      }
    }, 10000);
  });
}

async function initialize() {
  if (contentState.initialized) {
    console.log('ElevenPage Reader: Already initialized');
    return;
  }
  console.log('ElevenPage Reader: Initializing content script');
  try {
    contentState.parsedContent = await waitForContent();
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
