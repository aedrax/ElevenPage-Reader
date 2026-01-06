// ElevenPage Reader - Popup UI
// Extension popup for settings and controls

/**
 * Message types for communication with service worker
 */
const MessageType = {
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  SET_SPEED: 'setSpeed',
  GET_STATE: 'getState',
  GET_VOICES: 'getVoices',
  SET_API_KEY: 'setApiKey',
  SET_VOICE: 'setVoice',
  PLAYBACK_STATE_CHANGE: 'playbackStateChange',
  SET_AUTO_CONTINUE: 'setAutoContinue',
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
 * Storage keys
 */
const STORAGE_KEYS = {
  API_KEY: 'apiKey',
  SELECTED_VOICE_ID: 'selectedVoiceId',
  PLAYBACK_SPEED: 'playbackSpeed',
  AUTO_CONTINUE: 'autoContinue'
};

/**
 * PopupController - Manages popup UI state and interactions
 */
class PopupController {
  constructor() {
    this.elements = {};
    this.currentState = null;
    this.apiKeyVisible = false;
  }

  /**
   * Initialize the popup
   */
  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.loadSavedSettings();
    await this.syncState();
    this.setupMessageListener();
  }

  /**
   * Cache DOM element references
   */
  cacheElements() {
    this.elements = {
      apiKeyInput: document.getElementById('api-key-input'),
      toggleKeyVisibility: document.getElementById('toggle-key-visibility'),
      saveApiKey: document.getElementById('save-api-key'),
      apiKeyStatus: document.getElementById('api-key-status'),
      voiceSelect: document.getElementById('voice-select'),
      refreshVoices: document.getElementById('refresh-voices'),
      voiceStatus: document.getElementById('voice-status'),
      playPauseBtn: document.getElementById('play-pause-btn'),
      stopBtn: document.getElementById('stop-btn'),
      speedSelect: document.getElementById('speed-select'),
      playbackStatus: document.getElementById('playback-status'),
      errorDisplay: document.getElementById('error-display'),
      playIcon: document.querySelector('.play-icon'),
      pauseIcon: document.querySelector('.pause-icon'),
      statusIndicator: document.querySelector('.status-indicator'),
      statusText: document.querySelector('.status-text'),
      autoContinueCheckbox: document.getElementById('auto-continue-checkbox'),
      showPlayerBtn: document.getElementById('show-player-btn')
    };
  }


  /**
   * Bind event listeners
   */
  bindEvents() {
    // API Key events
    this.elements.toggleKeyVisibility.addEventListener('click', () => this.toggleApiKeyVisibility());
    this.elements.saveApiKey.addEventListener('click', () => this.saveApiKey());
    this.elements.apiKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.saveApiKey();
    });

    // Voice events
    this.elements.refreshVoices.addEventListener('click', () => this.loadVoices());
    this.elements.voiceSelect.addEventListener('change', () => this.selectVoice());

    // Playback events
    this.elements.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
    this.elements.stopBtn.addEventListener('click', () => this.stop());
    this.elements.speedSelect.addEventListener('change', () => this.setSpeed());

    // Auto-continue event
    this.elements.autoContinueCheckbox.addEventListener('change', () => this.toggleAutoContinue());

    // Show player button
    this.elements.showPlayerBtn.addEventListener('click', () => this.showPlayer());
  }

  /**
   * Load saved settings from storage
   */
  async loadSavedSettings() {
    try {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.API_KEY,
        STORAGE_KEYS.SELECTED_VOICE_ID,
        STORAGE_KEYS.PLAYBACK_SPEED
      ]);

      // Load API key (masked)
      if (result[STORAGE_KEYS.API_KEY]) {
        this.elements.apiKeyInput.value = this.maskApiKey(result[STORAGE_KEYS.API_KEY]);
        this.elements.apiKeyInput.dataset.hasKey = 'true';
        this.showStatus(this.elements.apiKeyStatus, 'API key configured', 'success');
        
        // Enable voice selection and load voices
        await this.loadVoices();
      }

      // Load playback speed
      if (result[STORAGE_KEYS.PLAYBACK_SPEED]) {
        this.elements.speedSelect.value = result[STORAGE_KEYS.PLAYBACK_SPEED];
      }

      // Pre-select saved voice after voices are loaded
      if (result[STORAGE_KEYS.SELECTED_VOICE_ID]) {
        this.elements.voiceSelect.dataset.savedVoiceId = result[STORAGE_KEYS.SELECTED_VOICE_ID];
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  /**
   * Mask API key for display
   * @param {string} key - The API key
   * @returns {string} Masked key
   */
  maskApiKey(key) {
    if (!key || key.length < 8) return '••••••••';
    return key.substring(0, 4) + '••••••••' + key.substring(key.length - 4);
  }

  /**
   * Toggle API key visibility
   */
  toggleApiKeyVisibility() {
    this.apiKeyVisible = !this.apiKeyVisible;
    
    if (this.apiKeyVisible) {
      // Show actual key from storage
      chrome.storage.local.get([STORAGE_KEYS.API_KEY], (result) => {
        if (result[STORAGE_KEYS.API_KEY]) {
          this.elements.apiKeyInput.type = 'text';
          this.elements.apiKeyInput.value = result[STORAGE_KEYS.API_KEY];
        }
      });
      this.elements.toggleKeyVisibility.textContent = '🔒';
    } else {
      // Mask the key
      chrome.storage.local.get([STORAGE_KEYS.API_KEY], (result) => {
        if (result[STORAGE_KEYS.API_KEY]) {
          this.elements.apiKeyInput.type = 'password';
          this.elements.apiKeyInput.value = this.maskApiKey(result[STORAGE_KEYS.API_KEY]);
        }
      });
      this.elements.toggleKeyVisibility.textContent = '👁';
    }
  }

  /**
   * Save API key
   */
  async saveApiKey() {
    const apiKey = this.elements.apiKeyInput.value.trim();
    
    // Don't save if it's the masked value
    if (apiKey.includes('••••')) {
      this.showStatus(this.elements.apiKeyStatus, 'Enter a new API key to save', 'info');
      return;
    }

    if (!apiKey) {
      this.showStatus(this.elements.apiKeyStatus, 'Please enter an API key', 'error');
      return;
    }

    try {
      const response = await this.sendMessage(MessageType.SET_API_KEY, { apiKey });
      
      if (response.success) {
        this.elements.apiKeyInput.dataset.hasKey = 'true';
        this.elements.apiKeyInput.value = this.maskApiKey(apiKey);
        this.elements.apiKeyInput.type = 'password';
        this.apiKeyVisible = false;
        this.elements.toggleKeyVisibility.textContent = '👁';
        this.showStatus(this.elements.apiKeyStatus, 'API key saved successfully', 'success');
        
        // Load voices with new key
        await this.loadVoices();
      } else {
        this.showStatus(this.elements.apiKeyStatus, response.error || 'Failed to save API key', 'error');
      }
    } catch (error) {
      this.showStatus(this.elements.apiKeyStatus, 'Error saving API key', 'error');
    }
  }


  /**
   * Load voices from ElevenLabs API
   */
  async loadVoices() {
    this.showStatus(this.elements.voiceStatus, 'Loading voices...', 'info');
    this.elements.voiceSelect.disabled = true;

    try {
      const response = await this.sendMessage(MessageType.GET_VOICES, {});
      
      if (response.success && response.voices) {
        this.populateVoiceDropdown(response.voices);
        this.elements.voiceSelect.disabled = false;
        this.showStatus(this.elements.voiceStatus, `${response.voices.length} voices loaded`, 'success');
        
        // Enable playback controls
        this.updatePlaybackControls();
      } else {
        this.showStatus(this.elements.voiceStatus, response.error || 'Failed to load voices', 'error');
      }
    } catch (error) {
      this.showStatus(this.elements.voiceStatus, 'Error loading voices', 'error');
    }
  }

  /**
   * Populate voice dropdown with voices
   * @param {Array} voices - Array of voice objects
   */
  populateVoiceDropdown(voices) {
    const select = this.elements.voiceSelect;
    const savedVoiceId = select.dataset.savedVoiceId;
    
    // Clear existing options except placeholder
    select.innerHTML = '<option value="">Select a voice...</option>';
    
    // Group voices by category
    const categories = {};
    voices.forEach(voice => {
      const category = voice.category || 'Other';
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(voice);
    });

    // Add voices grouped by category
    Object.keys(categories).sort().forEach(category => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = category.charAt(0).toUpperCase() + category.slice(1);
      
      categories[category].forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.voice_id;
        option.textContent = voice.name;
        option.dataset.voiceId = voice.voice_id;
        
        // Pre-select saved voice
        if (savedVoiceId && voice.voice_id === savedVoiceId) {
          option.selected = true;
        }
        
        optgroup.appendChild(option);
      });
      
      select.appendChild(optgroup);
    });
  }

  /**
   * Handle voice selection
   */
  async selectVoice() {
    const voiceId = this.elements.voiceSelect.value;
    
    if (!voiceId) return;

    try {
      const response = await this.sendMessage(MessageType.SET_VOICE, { voiceId });
      
      if (response.success) {
        this.showStatus(this.elements.voiceStatus, 'Voice selected', 'success');
        this.updatePlaybackControls();
      } else {
        this.showStatus(this.elements.voiceStatus, response.error || 'Failed to select voice', 'error');
      }
    } catch (error) {
      this.showStatus(this.elements.voiceStatus, 'Error selecting voice', 'error');
    }
  }

  /**
   * Toggle play/pause
   */
  async togglePlayPause() {
    if (!this.currentState) {
      await this.syncState();
    }

    const status = this.currentState?.status || PlaybackStatus.IDLE;

    if (status === PlaybackStatus.PLAYING) {
      await this.pause();
    } else {
      await this.play();
    }
  }

  /**
   * Start playback
   */
  async play() {
    try {
      const response = await this.sendMessage(MessageType.PLAY, {});
      
      if (!response.success) {
        this.showError(response.error || 'Failed to start playback');
      }
    } catch (error) {
      this.showError('Error starting playback');
    }
  }

  /**
   * Pause playback
   */
  async pause() {
    try {
      const response = await this.sendMessage(MessageType.PAUSE, {});
      
      if (!response.success) {
        this.showError(response.error || 'Failed to pause playback');
      }
    } catch (error) {
      this.showError('Error pausing playback');
    }
  }

  /**
   * Stop playback
   */
  async stop() {
    try {
      const response = await this.sendMessage(MessageType.STOP, {});
      
      if (!response.success) {
        this.showError(response.error || 'Failed to stop playback');
      }
    } catch (error) {
      this.showError('Error stopping playback');
    }
  }

  /**
   * Set playback speed
   */
  async setSpeed() {
    const speed = parseFloat(this.elements.speedSelect.value);

    try {
      const response = await this.sendMessage(MessageType.SET_SPEED, { speed });
      
      if (!response.success) {
        this.showError(response.error || 'Failed to set speed');
      }
    } catch (error) {
      this.showError('Error setting speed');
    }
  }

  /**
   * Toggle auto-continue setting
   */
  async toggleAutoContinue() {
    const autoContinue = this.elements.autoContinueCheckbox.checked;

    try {
      const response = await this.sendMessage(MessageType.SET_AUTO_CONTINUE, { autoContinue });
      
      if (!response.success) {
        // Revert checkbox state on failure
        this.elements.autoContinueCheckbox.checked = !autoContinue;
        this.showError(response.error || 'Failed to update auto-continue setting');
      }
    } catch (error) {
      // Revert checkbox state on error
      this.elements.autoContinueCheckbox.checked = !autoContinue;
      this.showError('Error updating auto-continue setting');
    }
  }

  /**
   * Show the floating player on the current page
   */
  async showPlayer() {
    try {
      const response = await this.sendMessage(MessageType.SHOW_PLAYER, {});
      
      if (!response.success) {
        this.showError(response.error || 'Could not show player on this page');
      }
    } catch (error) {
      this.showError('Error showing player - make sure you are on a webpage');
    }
  }


  /**
   * Sync state with service worker
   */
  async syncState() {
    try {
      const response = await this.sendMessage(MessageType.GET_STATE, {});
      
      if (response.success && response.state) {
        this.currentState = response.state;
        this.updateUI(response.state);
      }
    } catch (error) {
      console.error('Error syncing state:', error);
    }
  }

  /**
   * Setup message listener for state changes
   * Listens for PLAYBACK_STATE_CHANGE broadcasts from service worker
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === MessageType.PLAYBACK_STATE_CHANGE) {
        this.currentState = message.state;
        this.updateUI(message.state);
        console.log('Popup: State synchronized -', message.state?.status);
      }
      // Always send a response to avoid "message port closed" errors
      if (sendResponse) {
        sendResponse({ received: true });
      }
      return true;
    });
  }

  /**
   * Update UI based on playback state
   * @param {Object} state - Playback state
   */
  updateUI(state) {
    if (!state) return;

    // Update play/pause button
    const isPlaying = state.status === PlaybackStatus.PLAYING;
    const isPaused = state.status === PlaybackStatus.PAUSED;
    const isLoading = state.status === PlaybackStatus.LOADING;

    this.elements.playIcon.style.display = isPlaying ? 'none' : 'inline';
    this.elements.pauseIcon.style.display = isPlaying ? 'inline' : 'none';

    // Update status indicator
    this.elements.statusIndicator.className = 'status-indicator ' + state.status;
    
    // Update status text
    const statusTexts = {
      [PlaybackStatus.IDLE]: 'Ready',
      [PlaybackStatus.LOADING]: 'Loading...',
      [PlaybackStatus.PLAYING]: 'Playing',
      [PlaybackStatus.PAUSED]: 'Paused',
      [PlaybackStatus.ERROR]: 'Error'
    };
    this.elements.statusText.textContent = statusTexts[state.status] || 'Ready';

    // Update speed select
    if (state.speed) {
      this.elements.speedSelect.value = state.speed;
    }

    // Update auto-continue checkbox
    if (state.autoContinue !== undefined) {
      this.elements.autoContinueCheckbox.checked = state.autoContinue;
    }

    // Show/hide error
    if (state.status === PlaybackStatus.ERROR && state.error) {
      this.showError(state.error);
    } else {
      this.hideError();
    }

    // Update button states
    this.elements.playPauseBtn.disabled = isLoading;
    this.elements.stopBtn.disabled = state.status === PlaybackStatus.IDLE;
  }

  /**
   * Update playback controls based on configuration
   */
  updatePlaybackControls() {
    const hasApiKey = this.elements.apiKeyInput.dataset.hasKey === 'true';
    const hasVoice = this.elements.voiceSelect.value !== '';

    // Enable play button only if API key and voice are configured
    this.elements.playPauseBtn.disabled = !(hasApiKey && hasVoice);
  }

  /**
   * Send message to service worker
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   * @returns {Promise<Object>}
   */
  sendMessage(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
      });
    });
  }

  /**
   * Show status message
   * @param {HTMLElement} element - Status element
   * @param {string} message - Message to show
   * @param {string} type - Message type (success, error, info)
   */
  showStatus(element, message, type) {
    element.textContent = message;
    element.className = 'status-message ' + type;
    element.style.display = 'block';

    // Auto-hide success messages
    if (type === 'success') {
      setTimeout(() => {
        element.style.display = 'none';
      }, 3000);
    }
  }

  /**
   * Show error in error display
   * @param {string} message - Error message
   */
  showError(message) {
    this.elements.errorDisplay.textContent = message;
    this.elements.errorDisplay.style.display = 'block';
  }

  /**
   * Hide error display
   */
  hideError() {
    this.elements.errorDisplay.style.display = 'none';
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const controller = new PopupController();
  controller.init();
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PopupController,
    MessageType,
    PlaybackStatus,
    STORAGE_KEYS
  };
}
