// ElevenPage Reader - Floating Player
// Injects and manages the floating control overlay

/**
 * Message types for communication with service worker
 */
const MessageType = {
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  SET_SPEED: 'setSpeed',
  GET_STATE: 'getState',
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
 * Speed options for the speed control
 */
const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

/**
 * FloatingPlayer class manages the floating control overlay
 */
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
    this.currentState = {
      status: PlaybackStatus.IDLE,
      speed: 1.0
    };
    
    // Bind methods
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onPlayPauseClick = this.onPlayPauseClick.bind(this);
    this.onStopClick = this.onStopClick.bind(this);
    this.onSpeedChange = this.onSpeedChange.bind(this);
  }

  /**
   * Create the floating player DOM structure
   * @returns {HTMLElement}
   */
  createPlayerElement() {
    const container = document.createElement('div');
    container.className = 'elevenlabs-floating-player';
    container.id = 'elevenlabs-floating-player';
    
    // Header with drag handle
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
    
    // Controls container
    const controls = document.createElement('div');
    controls.className = 'elevenlabs-fp-controls';
    
    // Play/Pause button
    this.playPauseButton = document.createElement('button');
    this.playPauseButton.className = 'elevenlabs-fp-btn elevenlabs-fp-play-pause';
    this.playPauseButton.innerHTML = this.getPlayIcon();
    this.playPauseButton.title = 'Play';
    this.playPauseButton.addEventListener('click', this.onPlayPauseClick);
    controls.appendChild(this.playPauseButton);
    
    // Stop button
    this.stopButton = document.createElement('button');
    this.stopButton.className = 'elevenlabs-fp-btn elevenlabs-fp-stop';
    this.stopButton.innerHTML = this.getStopIcon();
    this.stopButton.title = 'Stop';
    this.stopButton.addEventListener('click', this.onStopClick);
    controls.appendChild(this.stopButton);
    
    // Speed control
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
    
    // Status text
    this.statusText = document.createElement('div');
    this.statusText.className = 'elevenlabs-fp-status';
    this.statusText.textContent = 'Ready';
    container.appendChild(this.statusText);
    
    return container;
  }


  /**
   * Get SVG icon for play button
   * @returns {string}
   */
  getPlayIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2.5v11l9-5.5-9-5.5z"/>
    </svg>`;
  }

  /**
   * Get SVG icon for pause button
   * @returns {string}
   */
  getPauseIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 2h4v12H3V2zm6 0h4v12H9V2z"/>
    </svg>`;
  }

  /**
   * Get SVG icon for stop button
   * @returns {string}
   */
  getStopIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="3" width="10" height="10"/>
    </svg>`;
  }

  /**
   * Show the floating player
   */
  show() {
    if (this.container) {
      this.container.style.display = 'block';
      return;
    }
    
    this.container = this.createPlayerElement();
    document.body.appendChild(this.container);
    
    // Set initial position
    this.setPosition(this.position.x, this.position.y);
    
    // Enable drag functionality
    this.enableDrag();
    
    // Sync with current state
    this.syncState();
  }

  /**
   * Hide the floating player
   */
  hide() {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  /**
   * Remove the floating player from DOM
   */
  destroy() {
    if (this.container) {
      // Remove event listeners
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

  /**
   * Check if player is visible
   * @returns {boolean}
   */
  isVisible() {
    return this.container && this.container.style.display !== 'none';
  }

  /**
   * Set the position of the floating player
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   */
  setPosition(x, y) {
    this.position = { x, y };
    if (this.container) {
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
    }
  }

  /**
   * Enable drag functionality for repositioning
   */
  enableDrag() {
    if (!this.container) return;
    
    const header = this.container.querySelector('.elevenlabs-fp-header');
    if (header) {
      header.addEventListener('mousedown', this.onMouseDown);
    }
  }

  /**
   * Handle mouse down for drag start
   * @param {MouseEvent} e
   */
  onMouseDown(e) {
    // Don't start drag if clicking on close button
    if (e.target.classList.contains('elevenlabs-fp-close')) return;
    
    this.isDragging = true;
    this.dragOffset = {
      x: e.clientX - this.position.x,
      y: e.clientY - this.position.y
    };
    
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    
    e.preventDefault();
  }

  /**
   * Handle mouse move for dragging
   * @param {MouseEvent} e
   */
  onMouseMove(e) {
    if (!this.isDragging) return;
    
    const newX = e.clientX - this.dragOffset.x;
    const newY = e.clientY - this.dragOffset.y;
    
    // Keep within viewport bounds
    const maxX = window.innerWidth - (this.container?.offsetWidth || 200);
    const maxY = window.innerHeight - (this.container?.offsetHeight || 100);
    
    const boundedX = Math.max(0, Math.min(newX, maxX));
    const boundedY = Math.max(0, Math.min(newY, maxY));
    
    this.setPosition(boundedX, boundedY);
  }

  /**
   * Handle mouse up for drag end
   * @param {MouseEvent} e
   */
  onMouseUp(e) {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }


  /**
   * Handle play/pause button click
   */
  async onPlayPauseClick() {
    const status = this.currentState.status;
    
    if (status === PlaybackStatus.PLAYING) {
      // Pause playback
      await this.sendMessage({ type: MessageType.PAUSE });
    } else if (status === PlaybackStatus.PAUSED) {
      // Resume playback
      await this.sendMessage({ type: MessageType.PLAY, payload: {} });
    }
    // If idle, do nothing - user should click paragraph button to start
  }

  /**
   * Handle stop button click
   */
  async onStopClick() {
    await this.sendMessage({ type: MessageType.STOP });
  }

  /**
   * Handle speed change
   * @param {Event} e
   */
  async onSpeedChange(e) {
    const speed = parseFloat(e.target.value);
    await this.sendMessage({
      type: MessageType.SET_SPEED,
      payload: { speed }
    });
  }

  /**
   * Send message to service worker
   * @param {Object} message
   * @returns {Promise<Object>}
   */
  async sendMessage(message) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(response || {});
        });
      } else {
        resolve({});
      }
    });
  }

  /**
   * Sync state with service worker
   */
  async syncState() {
    const response = await this.sendMessage({ type: MessageType.GET_STATE });
    if (response.success && response.state) {
      this.updatePlaybackState(response.state);
    }
  }

  /**
   * Update the UI based on playback state
   * @param {Object} state - Playback state object
   */
  updatePlaybackState(state) {
    this.currentState = state;
    
    // Update play/pause button
    if (this.playPauseButton) {
      if (state.status === PlaybackStatus.PLAYING) {
        this.playPauseButton.innerHTML = this.getPauseIcon();
        this.playPauseButton.title = 'Pause';
      } else {
        this.playPauseButton.innerHTML = this.getPlayIcon();
        this.playPauseButton.title = 'Play';
      }
      
      // Disable play/pause when idle (need to click paragraph button)
      this.playPauseButton.disabled = state.status === PlaybackStatus.IDLE || 
                                       state.status === PlaybackStatus.LOADING;
    }
    
    // Update stop button
    if (this.stopButton) {
      this.stopButton.disabled = state.status === PlaybackStatus.IDLE;
    }
    
    // Update status text
    if (this.statusText) {
      switch (state.status) {
        case PlaybackStatus.IDLE:
          this.statusText.textContent = 'Ready - Click a paragraph to start';
          break;
        case PlaybackStatus.LOADING:
          this.statusText.textContent = 'Loading...';
          break;
        case PlaybackStatus.PLAYING:
          this.statusText.textContent = 'Playing';
          break;
        case PlaybackStatus.PAUSED:
          this.statusText.textContent = 'Paused';
          break;
        case PlaybackStatus.ERROR:
          this.statusText.textContent = `Error: ${state.error || 'Unknown error'}`;
          break;
        default:
          this.statusText.textContent = 'Ready';
      }
    }
  }

  /**
   * Update the speed control value
   * @param {number} speed - Speed value (0.5 to 3.0)
   */
  updateSpeed(speed) {
    this.currentState.speed = speed;
    if (this.speedSelect) {
      this.speedSelect.value = speed.toString();
    }
  }
}

// Create singleton instance
const floatingPlayer = new FloatingPlayer();

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FloatingPlayer, floatingPlayer };
}
