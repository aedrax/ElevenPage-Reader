// ElevenPage Reader - ElevenLabs API Client
// Wrapper for ElevenLabs REST API calls

/**
 * ElevenLabs API base URL
 */
const API_BASE_URL = 'https://api.elevenlabs.io/v1';

/**
 * API Error types for categorized error handling
 */
const API_ERROR_TYPES = {
  INVALID_API_KEY: 'INVALID_API_KEY',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_VOICE: 'INVALID_VOICE',
  GENERATION_FAILED: 'GENERATION_FAILED',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Custom error class for ElevenLabs API errors
 */
class ElevenLabsAPIError extends Error {
  constructor(message, type, statusCode = null, originalError = null) {
    super(message);
    this.name = 'ElevenLabsAPIError';
    this.type = type;
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

/**
 * Validate API key format
 * @param {string} apiKey - The API key to validate
 * @returns {boolean} True if valid format
 */
function isValidApiKeyFormat(apiKey) {
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

/**
 * Parse API error response and return appropriate error type
 * @param {Response} response - Fetch response object
 * @param {string} responseText - Response body text
 * @returns {ElevenLabsAPIError}
 */
function parseAPIError(response, responseText) {
  const statusCode = response.status;
  
  if (statusCode === 401) {
    return new ElevenLabsAPIError(
      'Invalid API key. Please check your ElevenLabs API key.',
      API_ERROR_TYPES.INVALID_API_KEY,
      statusCode
    );
  }
  
  if (statusCode === 429) {
    return new ElevenLabsAPIError(
      'Rate limit exceeded. Please wait before making more requests.',
      API_ERROR_TYPES.RATE_LIMITED,
      statusCode
    );
  }
  
  if (statusCode === 404 || statusCode === 400) {
    // Try to parse error message from response
    let errorMessage = 'Invalid voice or request parameters.';
    try {
      const errorData = JSON.parse(responseText);
      if (errorData.detail?.message) {
        errorMessage = errorData.detail.message;
      }
    } catch (e) {
      // Use default message
    }
    return new ElevenLabsAPIError(
      errorMessage,
      API_ERROR_TYPES.INVALID_VOICE,
      statusCode
    );
  }
  
  if (statusCode >= 500) {
    return new ElevenLabsAPIError(
      'ElevenLabs server error. Please try again later.',
      API_ERROR_TYPES.GENERATION_FAILED,
      statusCode
    );
  }
  
  return new ElevenLabsAPIError(
    `API request failed with status ${statusCode}`,
    API_ERROR_TYPES.UNKNOWN,
    statusCode
  );
}


/**
 * Fetch available voices from ElevenLabs API
 * @param {string} apiKey - ElevenLabs API key
 * @returns {Promise<Array<{voice_id: string, name: string, category: string, labels: object}>>}
 * @throws {ElevenLabsAPIError} On API errors
 */
async function getVoices(apiKey) {
  // Validate API key
  if (!isValidApiKeyFormat(apiKey)) {
    throw new ElevenLabsAPIError(
      'API key is required and must be a non-empty string.',
      API_ERROR_TYPES.INVALID_API_KEY
    );
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/voices`, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    const responseText = await response.text();
    
    if (!response.ok) {
      throw parseAPIError(response, responseText);
    }
    
    const data = JSON.parse(responseText);
    
    // Return voices array with relevant fields
    return (data.voices || []).map(voice => ({
      voice_id: voice.voice_id,
      name: voice.name,
      category: voice.category || 'unknown',
      labels: voice.labels || {}
    }));
    
  } catch (error) {
    // Re-throw ElevenLabsAPIError as-is
    if (error instanceof ElevenLabsAPIError) {
      throw error;
    }
    
    // Wrap network errors
    throw new ElevenLabsAPIError(
      'Network error while fetching voices. Please check your connection.',
      API_ERROR_TYPES.NETWORK_ERROR,
      null,
      error
    );
  }
}

/**
 * Generate speech from text using ElevenLabs API with alignment data
 * @param {string} apiKey - ElevenLabs API key
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - Voice ID to use for synthesis
 * @param {object} options - Optional parameters
 * @param {number} options.stability - Voice stability (0-1), default 0.5
 * @param {number} options.similarityBoost - Similarity boost (0-1), default 0.75
 * @param {string} options.modelId - Model ID, default 'eleven_monolingual_v1'
 * @returns {Promise<{audio: ArrayBuffer, alignment: {characters: string[], character_start_times_seconds: number[], character_end_times_seconds: number[]}}>}
 * @throws {ElevenLabsAPIError} On API errors
 */
async function textToSpeech(apiKey, text, voiceId, options = {}) {
  // Validate API key
  if (!isValidApiKeyFormat(apiKey)) {
    throw new ElevenLabsAPIError(
      'API key is required and must be a non-empty string.',
      API_ERROR_TYPES.INVALID_API_KEY
    );
  }
  
  // Validate text
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ElevenLabsAPIError(
      'Text is required and must be a non-empty string.',
      API_ERROR_TYPES.GENERATION_FAILED
    );
  }
  
  // Validate voice ID
  if (typeof voiceId !== 'string' || voiceId.trim().length === 0) {
    throw new ElevenLabsAPIError(
      'Voice ID is required and must be a non-empty string.',
      API_ERROR_TYPES.INVALID_VOICE
    );
  }
  
  const {
    stability = 0.5,
    similarityBoost = 0.75,
    modelId = 'eleven_monolingual_v1'
  } = options;
  
  try {
    // Request with timestamps for word-level alignment
    const response = await fetch(
      `${API_BASE_URL}/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: modelId,
          voice_settings: {
            stability: stability,
            similarity_boost: similarityBoost
          }
        })
      }
    );
    
    const responseText = await response.text();
    
    if (!response.ok) {
      throw parseAPIError(response, responseText);
    }
    
    // Parse the response - it contains base64 audio and alignment data
    const data = JSON.parse(responseText);
    
    // Decode base64 audio to ArrayBuffer
    const audioBase64 = data.audio_base64;
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBuffer = bytes.buffer;
    
    // Extract alignment data
    const alignment = {
      characters: data.alignment?.characters || [],
      character_start_times_seconds: data.alignment?.character_start_times_seconds || [],
      character_end_times_seconds: data.alignment?.character_end_times_seconds || []
    };
    
    return {
      audio: audioBuffer,
      alignment: alignment
    };
    
  } catch (error) {
    // Re-throw ElevenLabsAPIError as-is
    if (error instanceof ElevenLabsAPIError) {
      throw error;
    }
    
    // Wrap network errors
    throw new ElevenLabsAPIError(
      'Network error while generating speech. Please check your connection.',
      API_ERROR_TYPES.NETWORK_ERROR,
      null,
      error
    );
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    API_BASE_URL,
    API_ERROR_TYPES,
    ElevenLabsAPIError,
    isValidApiKeyFormat,
    getVoices,
    textToSpeech
  };
}
