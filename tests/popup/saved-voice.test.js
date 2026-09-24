/**
 * Regression tests: the popup must show the previously chosen voice
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const context = describe;

const dom = new JSDOM('<!DOCTYPE html><body></body>');
global.document = dom.window.document;
global.window = dom.window;

const storage = {};
global.chrome = {
  storage: { local: { get: vi.fn(async (keys) => Object.fromEntries(keys.filter(k => k in storage).map(k => [k, storage[k]]))) } },
  runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() }, lastError: null }
};

const { PopupController, MessageType } = await import('../../src/popup/popup.js');

const VOICES = [
  { voice_id: 'v-rachel', name: 'Rachel', category: 'premade' },
  { voice_id: 'v-adam', name: 'Adam', category: 'premade' }
];

function createPopup() {
  const el = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);
  const popup = Object.create(PopupController.prototype);
  popup.elements = {
    apiKeyInput: el('input'),
    apiKeyStatus: el('div'),
    voiceSelect: el('select'),
    voiceStatus: el('div'),
    speedSelect: el('select'),
    autoStartCheckbox: el('input', { type: 'checkbox' })
  };
  popup.updatePlaybackControls = vi.fn();
  popup.sendMessage = vi.fn(async (type) =>
    type === MessageType.GET_VOICES ? { success: true, voices: VOICES } : { success: true });
  return popup;
}

describe('Popup remembers the selected voice', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key];
    storage.apiKey = 'sk-test-key-123456';
  });

  context('user picked a voice earlier and reopens the popup', () => {
    it('shows that voice instead of "Select a voice..." once voices load', async () => {
      storage.selectedVoiceId = 'v-adam';
      const popup = createPopup();

      await popup.loadSavedSettings();

      expect(popup.elements.voiceSelect.value).toBe('v-adam');
    });
  });

  context('user changes voice, then refreshes the voice list', () => {
    it('keeps the newly chosen voice rather than reverting to the one saved at popup open', async () => {
      storage.selectedVoiceId = 'v-rachel';
      const popup = createPopup();
      await popup.loadSavedSettings();

      popup.elements.voiceSelect.value = 'v-adam';
      await popup.selectVoice();
      await popup.loadVoices();

      expect(popup.elements.voiceSelect.value).toBe('v-adam');
    });
  });
});
