// ElevenPage Reader - Storage Utility
// Chrome storage wrapper for settings persistence

/**
 * Storage keys used by the extension
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
 * Default values for settings
 */
const DEFAULTS = {
  [STORAGE_KEYS.PLAYBACK_SPEED]: 1.0,
  [STORAGE_KEYS.AUTO_CONTINUE]: true
};

/**
 * Save a setting to Chrome storage
 * @param {string} key - The storage key
 * @param {*} value - The value to store
 * @returns {Promise<void>}
 */
async function saveSettings(key, value) {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('Storage key must be a non-empty string');
  }
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get a setting from Chrome storage
 * @param {string} key - The storage key
 * @returns {Promise<*>} The stored value or undefined
 */
async function getSettings(key) {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('Storage key must be a non-empty string');
  }
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result[key]);
      }
    });
  });
}

/**
 * Get all settings from Chrome storage
 * @returns {Promise<Object>} All stored settings
 */
async function getAllSettings() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Remove a setting from Chrome storage
 * @param {string} key - The storage key to remove
 * @returns {Promise<void>}
 */
async function removeSettings(key) {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('Storage key must be a non-empty string');
  }
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove([key], () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Clear all settings from Chrome storage
 * @returns {Promise<void>}
 */
async function clearAllSettings() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STORAGE_KEYS,
    DEFAULTS,
    saveSettings,
    getSettings,
    getAllSettings,
    removeSettings,
    clearAllSettings
  };
}
