// ElevenPage Reader - Service Worker
// Handles ElevenLabs API communication, audio management, and global state

import { MessageType, PlaybackStatus, STORAGE_KEYS } from '../shared/constants.js';
import { textToSpeech, getVoices } from '../../lib/elevenlabs-api.js';

/**
 * Early threshold in seconds for skip previous behavior
 * If current time < threshold, go to previous paragraph
 * If current time >= threshold, restart current paragraph
 */
const SKIP_PREVIOUS_THRESHOLD = 3;

/**
 * Current playback state
 */
let playbackState = {
  status: PlaybackStatus.IDLE,
  currentParagraphIndex: 0,
  currentSentenceIndex: 0,
  currentWordIndex: 0,
  currentTime: 0,
  speed: 1.0,
  error: null,
  autoContinue: true,
  totalParagraphs: 0,
  selectionMode: false    // Playing user-selected text rather than a parsed paragraph
};

/**
 * Audio playback context
 */
let audioContext = {
  audioData: null,        // Base64-encoded audio data
  alignmentData: null,    // Timestamp alignment data
  tabId: null,            // Tab ID where playback is active
  offscreenReady: false   // Whether offscreen document is ready
};

/**
 * Generation counter for play requests. Incremented whenever a new play or
 * stop supersedes in-flight work, so a stale TTS response is discarded
 * instead of starting playback the user has already replaced.
 */
let playbackGeneration = 0;

/**
 * AbortController for the in-flight play TTS request, so a superseding play
 * or stop cancels the network request instead of just discarding its result
 */
let playAbortController = null;

/**
 * Playback time of the last persisted state snapshot, used to throttle
 * session-storage writes during 50ms timeUpdate ticks
 */
let lastPersistedTime = 0;

/**
 * Preload state for next paragraph audio
 * Used for preemptive loading to eliminate delays between paragraphs
 */
let preloadState = {
  paragraphIndex: null,      // Index of preloaded paragraph
  audioData: null,           // Cached base64-encoded audio
  alignmentData: null,       // Cached alignment data
  pendingRequest: null,      // Promise for in-flight preload request
  abortController: null      // AbortController to cancel pending requests
};

/**
 * Clear preload state and cancel any pending requests
 */
function clearPreloadState() {
  if (preloadState.abortController) {
    preloadState.abortController.abort();
  }
  preloadState = {
    paragraphIndex: null,
    audioData: null,
    alignmentData: null,
    pendingRequest: null,
    abortController: null
  };
}

/**
 * Initiate preloading of next paragraph when conditions are met
 * Called after playback starts successfully
 * @param {number} currentParagraphIndex - Currently playing paragraph
 */
async function initiatePreload(currentParagraphIndex) {
  const { autoContinue, totalParagraphs } = playbackState;
  const nextIndex = currentParagraphIndex + 1;
  
  // Only preload if auto-continue is enabled and there's a next paragraph.
  // Selected text is read on its own, so there is nothing to continue into.
  if (playbackState.selectionMode || !autoContinue || nextIndex >= totalParagraphs) {
    return;
  }
  
  // Don't preload if already preloading or have cached the correct paragraph
  if (preloadState.paragraphIndex === nextIndex) {
    return;
  }
  
  // Don't preload if no active tab
  if (!audioContext.tabId) {
    return;
  }
  
  // Clear any existing preload state
  clearPreloadState();
  
  // Create abort controller for this request
  preloadState.abortController = new AbortController();
  preloadState.paragraphIndex = nextIndex;
  
  // Request next paragraph text from content script
  try {
    const response = await chrome.tabs.sendMessage(audioContext.tabId, {
      type: MessageType.GET_NEXT_PARAGRAPH,
      paragraphIndex: nextIndex
    });
    
    if (!response?.success || !response?.text) {
      clearPreloadState();
      return;
    }
    
    // Start preloading audio
    preloadState.pendingRequest = preloadAudio(response.text, nextIndex);
    await preloadState.pendingRequest;
    
  } catch (error) {
    console.log('Preload failed, will load on-demand:', error.message);
    clearPreloadState();
  }
}

/**
 * Preload audio for a paragraph
 * @param {string} text - Paragraph text
 * @param {number} paragraphIndex - Paragraph index
 */
async function preloadAudio(text, paragraphIndex) {
  const apiKey = await getFromStorage(STORAGE_KEYS.API_KEY);
  const voiceId = await getFromStorage(STORAGE_KEYS.SELECTED_VOICE_ID);
  
  if (!apiKey || !voiceId) {
    throw new Error('Missing API key or voice');
  }
  
  try {
    const response = await textToSpeech(apiKey, text, voiceId, {
      signal: preloadState.abortController?.signal
    });

    // Store in preload cache (only if still relevant)
    if (preloadState.paragraphIndex === paragraphIndex) {
      preloadState.audioData = response.audioBase64;
      preloadState.alignmentData = response.alignment;
      preloadState.pendingRequest = null;
    }
  } catch (error) {
    // Clear preload state on error
    if (preloadState.paragraphIndex === paragraphIndex) {
      clearPreloadState();
    }
    throw error;
  }
}


/**
 * Get a value from Chrome storage
 * @param {string} key - Storage key
 * @returns {Promise<*>}
 */
async function getFromStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

/**
 * Save a value to Chrome storage
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @returns {Promise<void>}
 */
async function saveToStorage(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

/**
 * chrome.storage.session keys for state that must survive service worker
 * suspension. MV3 suspends idle service workers after ~30s, wiping all
 * module-level variables — anything needed to resume a paused read has to
 * live here and be restored on the next wake-up.
 */
const SESSION_KEYS = {
  PLAYBACK_STATE: 'sessionPlaybackState',
  AUDIO_CONTEXT: 'sessionAudioContext'
};

/**
 * Read keys from chrome.storage.session, tolerating environments where the
 * API is unavailable
 * @param {string[]} keys - Keys to read
 * @returns {Promise<Object>}
 */
async function sessionGet(keys) {
  if (!chrome.storage?.session) return {};
  try {
    return await chrome.storage.session.get(keys);
  } catch (e) {
    console.warn('ElevenPage Reader: Failed to read session state:', e);
    return {};
  }
}

/**
 * Write items to chrome.storage.session. Persistence is best-effort: on
 * failure (missing API, quota exceeded) playback continues, resume just
 * falls back to re-fetching audio.
 * @param {Object} items - Items to write
 */
async function sessionSet(items) {
  if (!chrome.storage?.session) return;
  try {
    await chrome.storage.session.set(items);
  } catch (e) {
    console.warn('ElevenPage Reader: Failed to persist session state:', e);
  }
}

/**
 * Persist the current playback state so it survives worker suspension
 */
function persistPlaybackState() {
  lastPersistedTime = playbackState.currentTime;
  return sessionSet({ [SESSION_KEYS.PLAYBACK_STATE]: playbackState });
}

/**
 * Persist the audio context (minus offscreenReady, which is per-worker).
 * One paragraph of base64 audio fits comfortably in the 10MB session quota;
 * if a write fails, resume falls back to re-fetching the paragraph.
 */
function persistAudioContext() {
  return sessionSet({
    [SESSION_KEYS.AUDIO_CONTEXT]: {
      audioData: audioContext.audioData,
      alignmentData: audioContext.alignmentData,
      tabId: audioContext.tabId
    }
  });
}

/**
 * Restore state on service worker startup.
 * Settings come from local storage; live playback state comes from session
 * storage if a previous worker instance persisted it before being suspended.
 */
async function restoreState() {
  const savedSpeed = await getFromStorage(STORAGE_KEYS.PLAYBACK_SPEED);
  if (savedSpeed !== undefined && savedSpeed >= 0.5 && savedSpeed <= 3.0) {
    playbackState.speed = savedSpeed;
  }

  const savedAutoContinue = await getFromStorage(STORAGE_KEYS.AUTO_CONTINUE);
  // Default to true if not set
  playbackState.autoContinue = savedAutoContinue !== undefined ? savedAutoContinue : true;

  const stored = await sessionGet([SESSION_KEYS.PLAYBACK_STATE, SESSION_KEYS.AUDIO_CONTEXT]);

  const storedAudio = stored[SESSION_KEYS.AUDIO_CONTEXT];
  if (storedAudio) {
    audioContext.audioData = storedAudio.audioData || null;
    audioContext.alignmentData = storedAudio.alignmentData || null;
    audioContext.tabId = storedAudio.tabId || null;
  }

  const storedState = stored[SESSION_KEYS.PLAYBACK_STATE];
  if (storedState) {
    playbackState = { ...playbackState, ...storedState };
    // A worker cannot be suspended while audio is actually playing (the 50ms
    // timeUpdate messages keep it alive), so a restored PLAYING/LOADING
    // status is stale: downgrade to PAUSED when the audio survived, else IDLE.
    if (playbackState.status === PlaybackStatus.PLAYING ||
        playbackState.status === PlaybackStatus.LOADING) {
      playbackState.status = audioContext.audioData
        ? PlaybackStatus.PAUSED
        : PlaybackStatus.IDLE;
      await persistPlaybackState();
    }
  }

  console.log('ElevenPage Reader service worker initialized:', playbackState.status,
    'speed:', playbackState.speed, 'autoContinue:', playbackState.autoContinue);
}

/**
 * Get a copy of the current playback state
 * @returns {Object}
 */
function getPlaybackState() {
  return { ...playbackState };
}

/**
 * Update playback state and broadcast to all listeners
 * @param {Object} updates - State updates to apply
 */
async function updatePlaybackState(updates) {
  playbackState = { ...playbackState, ...updates };
  await persistPlaybackState();
  await broadcastStateChange();
}

/**
 * Broadcast state change to all content scripts and popup
 * This ensures state synchronization across all extension components
 */
async function broadcastStateChange() {
  const message = {
    type: MessageType.PLAYBACK_STATE_CHANGE,
    state: getPlaybackState()
  };
  
  // Broadcast to all tabs (content scripts)
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (e) {
        // Tab may not have content script, ignore
      }
    }
  } catch (e) {
    console.error('Error broadcasting state to tabs:', e);
  }
  
  // Broadcast to popup (if open) via runtime message
  // The popup listens for runtime messages with PLAYBACK_STATE_CHANGE type
  try {
    await chrome.runtime.sendMessage(message);
  } catch (e) {
    // Popup may not be open, ignore
    // This is expected when popup is closed
  }
}

/**
 * Get the current playback state for external queries
 * Used by content scripts and popup to sync their state
 * @returns {Object} Current playback state
 */
function getCurrentPlaybackState() {
  return getPlaybackState();
}


/**
 * Ask a tab's content script what to read when Play is pressed without text:
 * the current text selection, or else the first parsed paragraph.
 * Messages from the popup carry no sender tab, so fall back to the active tab.
 * @param {number|undefined} tabId - Tab the request came from, if any
 * @returns {Promise<Object>} { success, tabId, text, paragraphIndex, selection } or { success, error }
 */
async function requestPlayText(tabId) {
  const noTextError = 'No text to play. Select text on the page or click a paragraph.';
  try {
    if (!tabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = activeTab?.id;
    }
    if (!tabId) {
      return { success: false, error: noTextError };
    }
    const response = await chrome.tabs.sendMessage(tabId, { type: MessageType.GET_PLAY_TEXT });
    if (!response?.success || !response.text?.trim()) {
      return { success: false, error: response?.error || noTextError };
    }
    return {
      success: true,
      tabId,
      text: response.text,
      paragraphIndex: response.paragraphIndex ?? 0,
      selection: !!response.selection
    };
  } catch (error) {
    // No content script on this page (e.g. chrome:// pages, or not reloaded
    // since the extension was installed)
    return { success: false, error: noTextError };
  }
}

/**
 * Handle PLAY message
 * @param {Object} payload - Play request payload
 * @param {number} payload.tabId - Tab ID to play in
 * @param {string} payload.text - Text to convert to speech
 * @param {number} payload.paragraphIndex - Starting paragraph index
 * @returns {Promise<Object>}
 */
async function handlePlay(payload) {
  let { tabId, text, paragraphIndex = 0, selection = false } = payload;
  
  // Check if already playing
  if (playbackState.status === PlaybackStatus.PLAYING) {
    return { success: false, error: 'Already playing' };
  }

  // If paused, resume playback
  if (playbackState.status === PlaybackStatus.PAUSED) {
    if (audioContext.audioData) {
      // The offscreen document closes itself after ~30s without audio, and a
      // suspended worker loses it too. If it is gone, recreate it and restart
      // the stored audio from the paused position instead of resuming.
      if (await hasOffscreenDocument()) {
        await sendToOffscreen({ type: 'resume' });
      } else {
        await ensureOffscreenDocument();
        await sendToOffscreen({
          type: 'play',
          audioBase64: audioContext.audioData,
          speed: playbackState.speed,
          startTime: playbackState.currentTime
        });
      }
      await updatePlaybackState({ status: PlaybackStatus.PLAYING });
      return { success: true };
    }
    // Paused, but the audio did not survive suspension (e.g. persistence
    // failed): replay the current paragraph from the start.
    if (audioContext.tabId) {
      return requestAndPlayParagraph(playbackState.currentParagraphIndex);
    }
  }
  
  // Get API key and voice
  const apiKey = await getFromStorage(STORAGE_KEYS.API_KEY);
  const voiceId = await getFromStorage(STORAGE_KEYS.SELECTED_VOICE_ID);
  
  if (!apiKey) {
    return { success: false, error: 'API key not configured' };
  }
  
  if (!voiceId) {
    return { success: false, error: 'Voice not selected' };
  }
  
  // Play pressed without text (popup / floating player): ask the page for
  // the user's selection, falling back to the first paragraph
  if (!text || text.trim().length === 0) {
    const resolved = await requestPlayText(tabId);
    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }
    ({ tabId, text, paragraphIndex, selection } = resolved);
  }

  const generation = ++playbackGeneration;

  // Cancel any TTS request from a previous play that is still in flight
  playAbortController?.abort();
  playAbortController = new AbortController();
  const signal = playAbortController.signal;

  // Update state to loading
  await updatePlaybackState({
    status: PlaybackStatus.LOADING,
    currentParagraphIndex: paragraphIndex,
    currentSentenceIndex: 0,
    currentWordIndex: 0,
    currentTime: 0,
    error: null,
    selectionMode: !!selection
  });

  audioContext.tabId = tabId;

  try {
    // Request TTS from ElevenLabs API
    const response = await textToSpeech(apiKey, text, voiceId, { signal });

    // A newer play or stop request took over while audio was generating
    if (generation !== playbackGeneration) {
      return { success: false, error: 'Superseded by a newer request' };
    }

    audioContext.audioData = response.audioBase64;
    audioContext.alignmentData = response.alignment;
    await persistAudioContext();

    // Ensure offscreen document exists and play audio
    await ensureOffscreenDocument();

    await sendToOffscreen({
      type: 'play',
      audioBase64: response.audioBase64,
      speed: playbackState.speed
    });

    await updatePlaybackState({ status: PlaybackStatus.PLAYING });

    // Initiate preload for the next paragraph (for seamless auto-continue)
    await initiatePreload(paragraphIndex);

    return { success: true };
  } catch (error) {
    if (generation !== playbackGeneration) {
      return { success: false, error: 'Superseded by a newer request' };
    }
    await updatePlaybackState({
      status: PlaybackStatus.ERROR,
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Handle PAUSE message
 * @returns {Promise<Object>}
 */
async function handlePause() {
  if (playbackState.status !== PlaybackStatus.PLAYING) {
    return { success: false, error: 'Not currently playing' };
  }
  
  await sendToOffscreen({ type: 'pause' });
  await updatePlaybackState({ status: PlaybackStatus.PAUSED });
  
  return { success: true };
}

/**
 * Handle STOP message
 * @returns {Promise<Object>}
 */
async function handleStop() {
  // Invalidate any in-flight play request so its result is discarded
  playbackGeneration++;
  playAbortController?.abort();
  playAbortController = null;

  await stopOffscreenAudio();

  // Reset state
  audioContext.audioData = null;
  audioContext.alignmentData = null;

  // Clear any preloaded audio since playback is stopping
  clearPreloadState();
  await persistAudioContext();

  await updatePlaybackState({
    status: PlaybackStatus.IDLE,
    currentParagraphIndex: 0,
    currentSentenceIndex: 0,
    currentWordIndex: 0,
    currentTime: 0,
    error: null,
    selectionMode: false
  });
  
  return { success: true };
}

/**
 * Handle SET_SPEED message
 * @param {Object} payload - Speed payload
 * @param {number} payload.speed - New playback speed (0.5 to 3.0)
 * @returns {Promise<Object>}
 */
async function handleSetSpeed(payload) {
  const { speed } = payload;
  
  // Validate speed range
  if (typeof speed !== 'number' || speed < 0.5 || speed > 3.0) {
    return { success: false, error: 'Speed must be between 0.5 and 3.0' };
  }
  
  // Save to storage
  await saveToStorage(STORAGE_KEYS.PLAYBACK_SPEED, speed);
  
  // Update state (position remains unchanged)
  await updatePlaybackState({ speed });
  
  // Apply to current playback if playing
  if (playbackState.status === PlaybackStatus.PLAYING || 
      playbackState.status === PlaybackStatus.PAUSED) {
    await sendToOffscreen({ type: 'setSpeed', speed });
  }
  
  return { success: true };
}


/**
 * Handle SKIP_NEXT message
 * Advances to the next paragraph if one exists
 * @returns {Promise<Object>}
 */
async function handleSkipNext() {
  const { currentParagraphIndex, totalParagraphs } = playbackState;
  const nextIndex = currentParagraphIndex + 1;
  
  // Check if next paragraph exists
  if (nextIndex >= totalParagraphs) {
    // No next paragraph - stop playback
    return handleStop();
  }
  
  // Request and play next paragraph
  return requestAndPlayParagraph(nextIndex);
}

/**
 * Handle SKIP_PREVIOUS message
 * Either restarts current paragraph or goes to previous based on current time
 * @returns {Promise<Object>}
 */
async function handleSkipPrevious() {
  const { currentParagraphIndex, currentTime } = playbackState;
  
  // If time >= threshold OR at first paragraph, restart current paragraph
  if (currentTime >= SKIP_PREVIOUS_THRESHOLD || currentParagraphIndex === 0) {
    return requestAndPlayParagraph(currentParagraphIndex);
  }
  
  // Go to previous paragraph (time < threshold AND previous exists)
  return requestAndPlayParagraph(currentParagraphIndex - 1);
}

/**
 * Handle JUMP_TO_PARAGRAPH message
 * @param {Object} payload - Jump payload
 * @param {number} payload.paragraphIndex - Paragraph index to jump to
 * @param {string} payload.text - Text of the paragraph
 * @param {number} payload.tabId - Tab ID
 * @returns {Promise<Object>}
 */
async function handleJumpToParagraph(payload) {
  // Clear any preloaded audio that is no longer relevant
  // since the user is manually jumping to a different paragraph
  clearPreloadState();
  
  // Stop current playback first
  await handleStop();
  
  // Start playing from the new paragraph
  return handlePlay(payload);
}

/**
 * Handle GET_STATE message
 * @returns {Object}
 */
function handleGetState() {
  return { success: true, state: getPlaybackState() };
}

/**
 * Handle GET_VOICES message
 * @returns {Promise<Object>}
 */
async function handleGetVoices() {
  const apiKey = await getFromStorage(STORAGE_KEYS.API_KEY);
  
  if (!apiKey) {
    return { success: false, error: 'API key not configured' };
  }
  
  try {
    const voices = await getVoices(apiKey);
    return { success: true, voices };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle SET_API_KEY message
 * @param {Object} payload - API key payload
 * @param {string} payload.apiKey - The API key to save
 * @returns {Promise<Object>}
 */
async function handleSetApiKey(payload) {
  const { apiKey } = payload;
  
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return { success: false, error: 'Invalid API key' };
  }
  
  await saveToStorage(STORAGE_KEYS.API_KEY, apiKey.trim());
  return { success: true };
}

/**
 * Handle SET_VOICE message
 * @param {Object} payload - Voice payload
 * @param {string} payload.voiceId - The voice ID to save
 * @returns {Promise<Object>}
 */
async function handleSetVoice(payload) {
  const { voiceId } = payload;
  
  if (!voiceId || typeof voiceId !== 'string' || voiceId.trim().length === 0) {
    return { success: false, error: 'Invalid voice ID' };
  }
  
  await saveToStorage(STORAGE_KEYS.SELECTED_VOICE_ID, voiceId.trim());
  return { success: true };
}

/**
 * Handle SET_AUTO_CONTINUE message
 * @param {Object} payload - Auto-continue payload
 * @param {boolean} payload.autoContinue - The auto-continue setting
 * @returns {Promise<Object>}
 */
async function handleSetAutoContinue(payload) {
  const { autoContinue } = payload;
  
  // Validate that autoContinue is a boolean
  if (typeof autoContinue !== 'boolean') {
    return { success: false, error: 'Auto-continue must be a boolean' };
  }
  
  // Save to storage
  await saveToStorage(STORAGE_KEYS.AUTO_CONTINUE, autoContinue);
  
  // Clear preload state when auto-continue is disabled
  // This cancels any pending preload requests and clears cached audio
  if (!autoContinue) {
    clearPreloadState();
  }
  
  // Update playback state and broadcast change
  await updatePlaybackState({ autoContinue });
  
  return { success: true };
}

/**
 * Handle SET_TOTAL_PARAGRAPHS message
 * Updates the total paragraphs count for auto-continue boundary checking
 * @param {Object} payload - Total paragraphs payload
 * @param {number} payload.totalParagraphs - The total number of paragraphs on the page
 * @returns {Promise<Object>}
 */
async function handleSetTotalParagraphs(payload) {
  const { totalParagraphs } = payload;
  
  // Validate that totalParagraphs is a non-negative number
  if (typeof totalParagraphs !== 'number' || totalParagraphs < 0) {
    return { success: false, error: 'Total paragraphs must be a non-negative number' };
  }
  
  // Update playback state (no need to broadcast for this internal state)
  playbackState.totalParagraphs = totalParagraphs;
  await persistPlaybackState();

  return { success: true };
}

/**
 * Handle SHOW_PLAYER message
 * Sends a message to the content script to show the floating player
 * @param {number} tabId - Tab ID to show player in
 * @returns {Promise<Object>}
 */
async function handleShowPlayer(tabId) {
  if (!tabId) {
    // Get the active tab if no tabId provided
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  
  if (!tabId) {
    return { success: false, error: 'No active tab found' };
  }
  
  try {
    await chrome.tabs.sendMessage(tabId, { type: MessageType.SHOW_PLAYER });
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Content script not loaded on this page' };
  }
}

/**
 * Handle INITIALIZE message
 * Forwards initialization request to content script in active tab
 * Used for manual activation when auto-start is disabled
 * @returns {Promise<Object>}
 */
async function handleInitialize() {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab?.id) {
    return { success: false, error: 'No active tab found' };
  }
  
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: MessageType.INITIALIZE });
    return response || { success: false, error: 'No response from content script' };
  } catch (error) {
    return { success: false, error: 'Content script not loaded on this page' };
  }
}

/**
 * Offscreen document path
 */
const OFFSCREEN_DOCUMENT_PATH = 'src/background/offscreen.html';

/**
 * Check if offscreen document exists
 * @returns {Promise<boolean>}
 */
async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  return contexts.length > 0;
}

/**
 * Ensure offscreen document exists for audio playback
 */
async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }
  
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Playing text-to-speech audio from ElevenLabs'
    });
    audioContext.offscreenReady = true;
  } catch (error) {
    // Document may already exist
    if (!error.message.includes('already exists')) {
      throw error;
    }
  }
}

/**
 * Send message to offscreen document
 * @param {Object} message - Message to send
 */
async function sendToOffscreen(message) {
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', ...message });
  } catch (error) {
    // Offscreen document may not be ready yet
    console.error('Error sending to offscreen:', error);
  }
}

/**
 * Stop audio in the offscreen document if one exists. Skipping the message
 * when there is no document avoids "receiving end does not exist" errors on
 * every stop that happens before audio has ever played.
 */
async function stopOffscreenAudio() {
  if (await hasOffscreenDocument()) {
    await sendToOffscreen({ type: 'stop' });
  }
}

/**
 * Request paragraph text from content script and initiate playback
 * Used for skip next/previous navigation
 * @param {number} paragraphIndex - Index of paragraph to play
 * @returns {Promise<Object>}
 */
async function requestAndPlayParagraph(paragraphIndex) {
  // Clear preload state since we're manually navigating
  clearPreloadState();

  // Stop current audio via offscreen and drop it, so a suspension during the
  // upcoming load cannot restore stale audio under the new paragraph index
  await stopOffscreenAudio();
  audioContext.audioData = null;
  audioContext.alignmentData = null;
  await persistAudioContext();

  // Update state to loading
  await updatePlaybackState({
    status: PlaybackStatus.LOADING,
    currentParagraphIndex: paragraphIndex,
    currentTime: 0
  });
  
  // Request paragraph text from content script
  if (!audioContext.tabId) {
    await handleStop();
    return { success: false, error: 'No active tab' };
  }
  
  try {
    const response = await chrome.tabs.sendMessage(audioContext.tabId, {
      type: MessageType.GET_NEXT_PARAGRAPH,
      paragraphIndex
    });
    
    if (!response?.success || !response?.text) {
      await handleStop();
      return { success: false, error: 'Failed to get paragraph text' };
    }
    
    // Play the paragraph
    return handlePlay({
      tabId: audioContext.tabId,
      text: response.text,
      paragraphIndex
    });
  } catch (error) {
    console.error('Error during paragraph skip:', error);
    await handleStop();
    return { success: false, error: error.message };
  }
}

/**
 * Request next paragraph text from content script and initiate playback
 * @param {number} paragraphIndex - Index of the paragraph to request
 * @returns {Promise<void>}
 */
async function requestNextParagraph(paragraphIndex) {
  if (!audioContext.tabId) {
    await handleStop();
    return;
  }
  
  const message = {
    type: MessageType.GET_NEXT_PARAGRAPH,
    paragraphIndex
  };
  
  try {
    const response = await chrome.tabs.sendMessage(audioContext.tabId, message);
    
    if (response && response.success && response.text) {
      // Initiate playback of the next paragraph
      await handlePlay({
        tabId: audioContext.tabId,
        text: response.text,
        paragraphIndex: response.paragraphIndex
      });
    } else {
      // No more paragraphs or error - stop playback
      await handleStop();
    }
  } catch (error) {
    // Content script not responding or tab closed - stop playback
    console.error('Error requesting next paragraph:', error);
    await handleStop();
  }
}

/**
 * Handle audio playback ended event
 * Implements auto-continue logic to play next paragraph if enabled
 * Uses preloaded audio when available for seamless transitions
 * @returns {Promise<void>}
 */
async function handleAudioEnded() {
  const { autoContinue, currentParagraphIndex, totalParagraphs, selectionMode } = playbackState;
  
  // First, clean up the current audio state
  audioContext.audioData = null;
  audioContext.alignmentData = null;
  await persistAudioContext();

  // Check if auto-continue is enabled and there's a next paragraph
  if (selectionMode || !autoContinue || currentParagraphIndex >= totalParagraphs - 1) {
    // Stop playback - either auto-continue is disabled or we're at the last paragraph
    clearPreloadState();
    await handleStop();
    return;
  }
  
  const nextIndex = currentParagraphIndex + 1;
  
  // Check if we have preloaded audio for the next paragraph
  if (preloadState.paragraphIndex === nextIndex && preloadState.audioData) {
    // Use cached audio immediately
    await playPreloadedAudio(nextIndex);
  } else if (preloadState.paragraphIndex === nextIndex && preloadState.pendingRequest) {
    // Wait for pending preload to complete
    await updatePlaybackState({ status: PlaybackStatus.LOADING });
    try {
      await preloadState.pendingRequest;
      if (preloadState.audioData) {
        await playPreloadedAudio(nextIndex);
      } else {
        // Preload failed, fall back to on-demand
        await requestNextParagraph(nextIndex);
      }
    } catch (error) {
      // Preload failed, fall back to on-demand
      console.log('Preload request failed, falling back to on-demand:', error.message);
      await requestNextParagraph(nextIndex);
    }
  } else {
    // No preload available, load on-demand (fallback)
    await updatePlaybackState({ status: PlaybackStatus.LOADING });
    await requestNextParagraph(nextIndex);
  }
}

/**
 * Play preloaded audio for a paragraph
 * Moves preloaded data to active audio context and starts playback
 * @param {number} paragraphIndex - Paragraph index to play
 * @returns {Promise<void>}
 */
async function playPreloadedAudio(paragraphIndex) {
  // Move preloaded data to active audio context
  audioContext.audioData = preloadState.audioData;
  audioContext.alignmentData = preloadState.alignmentData;
  await persistAudioContext();

  // Clear preload state
  clearPreloadState();
  
  // Update state
  await updatePlaybackState({
    status: PlaybackStatus.PLAYING,
    currentParagraphIndex: paragraphIndex,
    currentSentenceIndex: 0,
    currentWordIndex: 0,
    currentTime: 0
  });
  
  // Play the audio
  await ensureOffscreenDocument();
  await sendToOffscreen({
    type: 'play',
    audioBase64: audioContext.audioData,
    speed: playbackState.speed
  });
  
  // Initiate preload for the next paragraph
  await initiatePreload(paragraphIndex);
}

/**
 * Handle messages from offscreen document
 * @param {Object} message - Message from offscreen
 */
async function handleOffscreenMessage(message) {
  if (message.target !== 'service-worker') return;
  
  switch (message.type) {
    case 'timeUpdate':
      // Update current time and broadcast highlight updates
      playbackState.currentTime = message.currentTime;
      // Persist position at most every ~2s of playback so an unexpected
      // worker death loses little progress (status changes persist instantly)
      if (Math.abs(message.currentTime - lastPersistedTime) >= 2) {
        persistPlaybackState();
      }
      await broadcastHighlightUpdate(message.currentTime);
      break;
      
    case 'ended':
      // Audio playback completed - check for auto-continue
      await handleAudioEnded();
      break;
      
    case 'error':
      await updatePlaybackState({
        status: PlaybackStatus.ERROR,
        error: message.error
      });
      break;
  }
}

/**
 * Broadcast highlight update based on current time
 * @param {number} currentTime - Current audio time in seconds
 */
async function broadcastHighlightUpdate(currentTime) {
  if (!audioContext.tabId || !audioContext.alignmentData) return;
  // Selected text has no word spans to highlight
  if (playbackState.selectionMode) return;
  
  const message = {
    type: MessageType.HIGHLIGHT_UPDATE,
    currentTime,
    alignment: audioContext.alignmentData,
    paragraphIndex: playbackState.currentParagraphIndex
  };
  
  try {
    await chrome.tabs.sendMessage(audioContext.tabId, message);
  } catch (e) {
    // Tab may have been closed
  }
}

/**
 * Main message handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle messages from offscreen document
  if (message.target === 'service-worker') {
    stateReady.then(() => handleOffscreenMessage(message));
    return;
  }

  // Handle messages from content scripts and popup
  const handleMessage = async () => {
    // Never act on default (empty) state before restoration completes
    await stateReady;
    switch (message.type) {
      case MessageType.PLAY:
        return handlePlay({ ...message.payload, tabId: sender.tab?.id });
        
      case MessageType.PAUSE:
        return handlePause();
        
      case MessageType.STOP:
        return handleStop();
        
      case MessageType.SET_SPEED:
        return handleSetSpeed(message.payload);
        
      case MessageType.JUMP_TO_PARAGRAPH:
        return handleJumpToParagraph({ ...message.payload, tabId: sender.tab?.id });
        
      case MessageType.SKIP_NEXT:
        return handleSkipNext();
        
      case MessageType.SKIP_PREVIOUS:
        return handleSkipPrevious();
        
      case MessageType.GET_STATE:
        return handleGetState();
        
      case MessageType.GET_VOICES:
        return handleGetVoices();
        
      case MessageType.SET_API_KEY:
        return handleSetApiKey(message.payload);
        
      case MessageType.SET_VOICE:
        return handleSetVoice(message.payload);
        
      case MessageType.SET_AUTO_CONTINUE:
        return handleSetAutoContinue(message.payload);
        
      case MessageType.SET_TOTAL_PARAGRAPHS:
        return handleSetTotalParagraphs(message.payload);
        
      case MessageType.SHOW_PLAYER:
        return handleShowPlayer(sender.tab?.id);
        
      case MessageType.INITIALIZE:
        return handleInitialize();
        
      default:
        return { success: false, error: 'Unknown message type' };
    }
  };
  
  handleMessage().then(sendResponse);
  return true; // Keep channel open for async response
});

/**
 * Handle tab close - stop playback if active tab closes
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await stateReady;
  if (tabId === audioContext.tabId) {
    console.log('ElevenPage Reader: Active tab closed, stopping playback');
    handleStop();
  }
});

/**
 * Handle tab navigation - stop playback if active tab navigates
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  await stateReady;
  if (tabId === audioContext.tabId && changeInfo.status === 'loading') {
    console.log('ElevenPage Reader: Active tab navigating, stopping playback');
    handleStop();
  }
});

/**
 * Handle tab activation changes - useful for future features
 */
chrome.tabs.onActivated.addListener((activeInfo) => {
  // Currently we don't pause on tab switch, but this hook is available
  // for future enhancements if needed
});

// Restore state on every service worker start (including wake-ups after
// suspension); handlers await this before touching state
const stateReady = restoreState();

// Export for testing
const getPreloadState = () => ({ ...preloadState });
const setAudioContextTabId = (tabId) => { audioContext.tabId = tabId; };

export {
  MessageType,
  PlaybackStatus,
  SKIP_PREVIOUS_THRESHOLD,
  getPlaybackState,
  updatePlaybackState,
  broadcastStateChange,
  getCurrentPlaybackState,
  handlePlay,
  handlePause,
  handleStop,
  handleSetSpeed,
  handleGetState,
  handleSetAutoContinue,
  handleSetTotalParagraphs,
  handleJumpToParagraph,
  handleSkipNext,
  handleSkipPrevious,
  handleInitialize,
  requestAndPlayParagraph,
  handleAudioEnded,
  requestNextParagraph,
  restoreState,
  // Preload functions
  clearPreloadState,
  initiatePreload,
  preloadAudio,
  playPreloadedAudio,
  getPreloadState,
  setAudioContextTabId
};
