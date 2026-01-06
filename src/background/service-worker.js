// ElevenPage Reader - Service Worker
// Handles ElevenLabs API communication, audio management, and global state

/**
 * Message types for communication between components
 */
const MessageType = {
  // Playback control
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  SET_SPEED: 'setSpeed',
  JUMP_TO_PARAGRAPH: 'jumpToParagraph',
  
  // State queries
  GET_STATE: 'getState',
  GET_VOICES: 'getVoices',
  
  // Settings
  SET_API_KEY: 'setApiKey',
  SET_VOICE: 'setVoice',
  SET_AUTO_CONTINUE: 'setAutoContinue',
  
  // Auto-continue
  GET_NEXT_PARAGRAPH: 'getNextParagraph',
  SET_TOTAL_PARAGRAPHS: 'setTotalParagraphs',
  
  // UI control
  SHOW_PLAYER: 'showPlayer',
  
  // Events to content script
  HIGHLIGHT_UPDATE: 'highlightUpdate',
  PLAYBACK_STATE_CHANGE: 'playbackStateChange'
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
  totalParagraphs: 0
};

/**
 * Audio playback context
 */
let audioContext = {
  audioData: null,        // ArrayBuffer of audio data
  alignmentData: null,    // Timestamp alignment data
  tabId: null,            // Tab ID where playback is active
  offscreenReady: false   // Whether offscreen document is ready
};

/**
 * Preload state for next paragraph audio
 * Used for preemptive loading to eliminate delays between paragraphs
 */
let preloadState = {
  paragraphIndex: null,      // Index of preloaded paragraph
  audioData: null,           // Cached ArrayBuffer of audio
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
  
  // Only preload if auto-continue is enabled and there's a next paragraph
  if (!autoContinue || nextIndex >= totalParagraphs) {
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
    const response = await generateSpeech(apiKey, text, voiceId);
    
    // Store in preload cache (only if still relevant)
    if (preloadState.paragraphIndex === paragraphIndex) {
      preloadState.audioData = response.audio;
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
 * Storage keys (matching lib/storage.js)
 */
const STORAGE_KEYS = {
  API_KEY: 'apiKey',
  SELECTED_VOICE_ID: 'selectedVoiceId',
  PLAYBACK_SPEED: 'playbackSpeed',
  CACHED_VOICES: 'cachedVoices',
  VOICES_CACHED_AT: 'voicesCachedAt',
  AUTO_CONTINUE: 'autoContinue'
};

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
 * Initialize playback state from storage
 */
async function initializeState() {
  const savedSpeed = await getFromStorage(STORAGE_KEYS.PLAYBACK_SPEED);
  if (savedSpeed !== undefined && savedSpeed >= 0.5 && savedSpeed <= 3.0) {
    playbackState.speed = savedSpeed;
  }
  
  const savedAutoContinue = await getFromStorage(STORAGE_KEYS.AUTO_CONTINUE);
  // Default to true if not set
  playbackState.autoContinue = savedAutoContinue !== undefined ? savedAutoContinue : true;
  
  console.log('ElevenPage Reader service worker initialized with speed:', playbackState.speed, 'autoContinue:', playbackState.autoContinue);
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
 * Handle PLAY message
 * @param {Object} payload - Play request payload
 * @param {number} payload.tabId - Tab ID to play in
 * @param {string} payload.text - Text to convert to speech
 * @param {number} payload.paragraphIndex - Starting paragraph index
 * @returns {Promise<Object>}
 */
async function handlePlay(payload) {
  const { tabId, text, paragraphIndex = 0 } = payload;
  
  // Check if already playing
  if (playbackState.status === PlaybackStatus.PLAYING) {
    return { success: false, error: 'Already playing' };
  }
  
  // If paused, resume playback
  if (playbackState.status === PlaybackStatus.PAUSED && audioContext.audioData) {
    await updatePlaybackState({ status: PlaybackStatus.PLAYING });
    await sendToOffscreen({ type: 'resume' });
    return { success: true };
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
  
  if (!text || text.trim().length === 0) {
    return { success: false, error: 'No text to play' };
  }
  
  // Update state to loading
  await updatePlaybackState({
    status: PlaybackStatus.LOADING,
    currentParagraphIndex: paragraphIndex,
    currentSentenceIndex: 0,
    currentWordIndex: 0,
    currentTime: 0,
    error: null
  });
  
  audioContext.tabId = tabId;
  
  try {
    // Request TTS from ElevenLabs API
    const response = await generateSpeech(apiKey, text, voiceId);
    
    audioContext.audioData = response.audio;
    audioContext.alignmentData = response.alignment;
    
    // Ensure offscreen document exists and play audio
    await ensureOffscreenDocument();
    
    // Convert ArrayBuffer to base64 for messaging (ArrayBuffer can't be sent directly)
    const audioBase64 = arrayBufferToBase64(response.audio);
    
    await sendToOffscreen({
      type: 'play',
      audioBase64: audioBase64,
      speed: playbackState.speed
    });
    
    await updatePlaybackState({ status: PlaybackStatus.PLAYING });
    
    // Initiate preload for the next paragraph (for seamless auto-continue)
    await initiatePreload(paragraphIndex);
    
    return { success: true };
  } catch (error) {
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
  await sendToOffscreen({ type: 'stop' });
  
  // Reset state
  audioContext.audioData = null;
  audioContext.alignmentData = null;
  
  // Clear any preloaded audio since playback is stopping
  clearPreloadState();
  
  await updatePlaybackState({
    status: PlaybackStatus.IDLE,
    currentParagraphIndex: 0,
    currentSentenceIndex: 0,
    currentWordIndex: 0,
    currentTime: 0,
    error: null
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
    const voices = await fetchVoices(apiKey);
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
 * Generate speech using ElevenLabs API
 * @param {string} apiKey - API key
 * @param {string} text - Text to convert
 * @param {string} voiceId - Voice ID
 * @returns {Promise<{audio: ArrayBuffer, alignment: Object}>}
 */
async function generateSpeech(apiKey, text, voiceId) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    }
  );
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.detail?.message || errorData.detail?.status || `API error: ${response.status}`;
    throw new Error(errorMessage);
  }
  
  const data = await response.json();
  
  // Decode base64 audio
  const binaryString = atob(data.audio_base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return {
    audio: bytes.buffer,
    alignment: data.alignment || {
      characters: [],
      character_start_times_seconds: [],
      character_end_times_seconds: []
    }
  };
}

/**
 * Fetch voices from ElevenLabs API
 * @param {string} apiKey - API key
 * @returns {Promise<Array>}
 */
async function fetchVoices(apiKey) {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    method: 'GET',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.detail?.message || errorData.detail?.status || `API error: ${response.status}`;
    throw new Error(errorMessage);
  }
  
  const data = await response.json();
  return (data.voices || []).map(voice => ({
    voice_id: voice.voice_id,
    name: voice.name,
    category: voice.category || 'unknown',
    labels: voice.labels || {}
  }));
}


/**
 * Convert ArrayBuffer to base64 string for messaging
 * @param {ArrayBuffer} buffer - ArrayBuffer to convert
 * @returns {string} Base64 encoded string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
  const { autoContinue, currentParagraphIndex, totalParagraphs } = playbackState;
  
  // First, clean up the current audio state
  audioContext.audioData = null;
  audioContext.alignmentData = null;
  
  // Check if auto-continue is enabled and there's a next paragraph
  if (!autoContinue || currentParagraphIndex >= totalParagraphs - 1) {
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
  const audioBase64 = arrayBufferToBase64(audioContext.audioData);
  await sendToOffscreen({
    type: 'play',
    audioBase64: audioBase64,
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
    handleOffscreenMessage(message);
    return;
  }
  
  // Handle messages from content scripts and popup
  const handleMessage = async () => {
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
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === audioContext.tabId) {
    console.log('ElevenPage Reader: Active tab closed, stopping playback');
    handleStop();
  }
});

/**
 * Handle tab navigation - stop playback if active tab navigates
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
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

// Initialize state on service worker start
initializeState();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MessageType,
    PlaybackStatus,
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
    handleAudioEnded,
    requestNextParagraph,
    // Preload functions
    clearPreloadState,
    initiatePreload,
    preloadAudio,
    playPreloadedAudio,
    getPreloadState: () => ({ ...preloadState }),
    setAudioContextTabId: (tabId) => { audioContext.tabId = tabId; }
  };
}
