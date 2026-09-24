// ElevenPage Reader - Shared Constants
// Single source of truth for message types, playback status values, and
// storage keys used by the service worker, content scripts, popup, and lib.

/**
 * Message types for communication between extension components
 */
export const MessageType = {
  // Playback control
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  SET_SPEED: 'setSpeed',
  JUMP_TO_PARAGRAPH: 'jumpToParagraph',
  SKIP_NEXT: 'skipNext',
  SKIP_PREVIOUS: 'skipPrevious',

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
  INITIALIZE: 'initialize',

  // Events to content script
  HIGHLIGHT_UPDATE: 'highlightUpdate',
  PLAYBACK_STATE_CHANGE: 'playbackStateChange'
};

/**
 * Playback status enum
 */
export const PlaybackStatus = {
  IDLE: 'idle',
  LOADING: 'loading',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ERROR: 'error'
};

/**
 * chrome.storage.local keys used by the extension
 */
export const STORAGE_KEYS = {
  API_KEY: 'apiKey',
  SELECTED_VOICE_ID: 'selectedVoiceId',
  PLAYBACK_SPEED: 'playbackSpeed',
  CACHED_VOICES: 'cachedVoices',
  VOICES_CACHED_AT: 'voicesCachedAt',
  AUTO_CONTINUE: 'autoContinue',
  AUTO_START: 'autoStart',
  PLAYER_HIDDEN: 'playerHidden'
};

/**
 * Default values for settings
 */
export const DEFAULTS = {
  [STORAGE_KEYS.PLAYBACK_SPEED]: 1.0,
  [STORAGE_KEYS.AUTO_CONTINUE]: true,
  [STORAGE_KEYS.AUTO_START]: true
};
