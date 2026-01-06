// ElevenPage Reader - Offscreen Document for Audio Playback
// This document handles actual audio playback since service workers cannot use Audio API

/**
 * Audio element for playback
 */
let audioElement = null;

/**
 * Current playback speed
 */
let currentSpeed = 1.0;

/**
 * Time update interval ID
 */
let timeUpdateInterval = null;

/**
 * Create audio element from ArrayBuffer
 * @param {ArrayBuffer} audioData - Audio data as ArrayBuffer
 * @returns {HTMLAudioElement}
 */
function createAudioElement(audioData) {
  // Clean up existing audio
  if (audioElement) {
    audioElement.pause();
    audioElement.src = '';
    audioElement = null;
  }
  
  // Create blob URL from audio data
  const blob = new Blob([audioData], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  
  // Create audio element
  audioElement = new Audio(url);
  audioElement.playbackRate = currentSpeed;
  
  // Set up event listeners
  audioElement.addEventListener('ended', handleEnded);
  audioElement.addEventListener('error', handleError);
  
  return audioElement;
}

/**
 * Start time update reporting
 */
function startTimeUpdates() {
  stopTimeUpdates();
  
  timeUpdateInterval = setInterval(() => {
    if (audioElement && !audioElement.paused) {
      sendToServiceWorker({
        type: 'timeUpdate',
        currentTime: audioElement.currentTime
      });
    }
  }, 50); // Update every 50ms for smooth highlighting
}

/**
 * Stop time update reporting
 */
function stopTimeUpdates() {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
    timeUpdateInterval = null;
  }
}

/**
 * Handle audio ended event
 */
function handleEnded() {
  stopTimeUpdates();
  sendToServiceWorker({ type: 'ended' });
}

/**
 * Handle audio error event
 * @param {Event} event - Error event
 */
function handleError(event) {
  stopTimeUpdates();
  sendToServiceWorker({
    type: 'error',
    error: 'Audio playback error'
  });
}

/**
 * Send message to service worker
 * @param {Object} message - Message to send
 */
function sendToServiceWorker(message) {
  chrome.runtime.sendMessage({
    target: 'service-worker',
    ...message
  });
}


/**
 * Handle play command
 * @param {ArrayBuffer} audioData - Audio data to play
 * @param {number} speed - Playback speed
 */
async function handlePlay(audioData, speed) {
  currentSpeed = speed;
  
  const audio = createAudioElement(audioData);
  
  try {
    await audio.play();
    startTimeUpdates();
  } catch (error) {
    sendToServiceWorker({
      type: 'error',
      error: error.message
    });
  }
}

/**
 * Handle pause command
 */
function handlePause() {
  if (audioElement) {
    audioElement.pause();
    stopTimeUpdates();
  }
}

/**
 * Handle resume command
 */
async function handleResume() {
  if (audioElement) {
    try {
      await audioElement.play();
      startTimeUpdates();
    } catch (error) {
      sendToServiceWorker({
        type: 'error',
        error: error.message
      });
    }
  }
}

/**
 * Handle stop command
 */
function handleStop() {
  stopTimeUpdates();
  
  if (audioElement) {
    audioElement.pause();
    audioElement.currentTime = 0;
    audioElement.src = '';
    audioElement = null;
  }
}

/**
 * Handle set speed command
 * @param {number} speed - New playback speed
 */
function handleSetSpeed(speed) {
  currentSpeed = speed;
  
  if (audioElement) {
    // Store current time before changing speed
    const currentTime = audioElement.currentTime;
    audioElement.playbackRate = speed;
    // Ensure position is maintained
    audioElement.currentTime = currentTime;
  }
}

/**
 * Message listener for commands from service worker
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages targeted at offscreen document
  if (message.target !== 'offscreen') return;
  
  switch (message.type) {
    case 'play':
      handlePlay(message.audio, message.speed);
      break;
      
    case 'pause':
      handlePause();
      break;
      
    case 'resume':
      handleResume();
      break;
      
    case 'stop':
      handleStop();
      break;
      
    case 'setSpeed':
      handleSetSpeed(message.speed);
      break;
  }
});

console.log('ElevenPage Reader offscreen document ready');
