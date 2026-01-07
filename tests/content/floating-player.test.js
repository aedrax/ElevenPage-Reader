/**
 * Unit tests for FloatingPlayer button creation and ordering
 * 
 * Feature: paragraph-skip-controls
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// Create a mock DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;

// Mock chrome API
global.chrome = {
  runtime: {
    sendMessage: vi.fn().mockImplementation((message, callback) => {
      if (callback) {
        callback({ success: true, state: { status: 'idle', speed: 1.0, autoContinue: true } });
      }
      return Promise.resolve({ success: true, state: { status: 'idle', speed: 1.0, autoContinue: true } });
    })
  }
};

// Import FloatingPlayer after setting up mocks
const { FloatingPlayer } = await import('../../src/content/floating-player.js');

describe('FloatingPlayer - Button Creation and Ordering', () => {
  let player;

  beforeEach(() => {
    // Clear the document body
    document.body.innerHTML = '';
    vi.clearAllMocks();
    
    // Create a new player instance
    player = new FloatingPlayer();
  });

  afterEach(() => {
    // Clean up
    if (player) {
      player.destroy();
    }
    document.body.innerHTML = '';
  });

  /**
   * Unit tests for button creation and ordering
   * Verifies buttons are created with correct classes and attributes
   * Verifies button order: skip prev, play/pause, skip next, stop, auto-continue
   * 
   * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
   */
  describe('Button Creation', () => {
    
    it('should create skip previous button with correct class', () => {
      player.show();
      
      expect(player.skipPreviousButton).not.toBeNull();
      expect(player.skipPreviousButton.classList.contains('elevenlabs-fp-btn')).toBe(true);
      expect(player.skipPreviousButton.classList.contains('elevenlabs-fp-skip-prev')).toBe(true);
    });

    it('should create skip next button with correct class', () => {
      player.show();
      
      expect(player.skipNextButton).not.toBeNull();
      expect(player.skipNextButton.classList.contains('elevenlabs-fp-btn')).toBe(true);
      expect(player.skipNextButton.classList.contains('elevenlabs-fp-skip-next')).toBe(true);
    });

    it('should create skip previous button with correct title attribute', () => {
      player.show();
      
      expect(player.skipPreviousButton.title).toBe('Previous paragraph');
    });

    it('should create skip next button with correct title attribute', () => {
      player.show();
      
      expect(player.skipNextButton.title).toBe('Next paragraph');
    });

    it('should create skip previous button with SVG icon', () => {
      player.show();
      
      const svg = player.skipPreviousButton.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('width')).toBe('16');
      expect(svg.getAttribute('height')).toBe('16');
    });

    it('should create skip next button with SVG icon', () => {
      player.show();
      
      const svg = player.skipNextButton.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('width')).toBe('16');
      expect(svg.getAttribute('height')).toBe('16');
    });

    it('should create play/pause button', () => {
      player.show();
      
      expect(player.playPauseButton).not.toBeNull();
      expect(player.playPauseButton.classList.contains('elevenlabs-fp-btn')).toBe(true);
      expect(player.playPauseButton.classList.contains('elevenlabs-fp-play-pause')).toBe(true);
    });

    it('should create stop button', () => {
      player.show();
      
      expect(player.stopButton).not.toBeNull();
      expect(player.stopButton.classList.contains('elevenlabs-fp-btn')).toBe(true);
      expect(player.stopButton.classList.contains('elevenlabs-fp-stop')).toBe(true);
    });
  });

  describe('Button Ordering', () => {
    
    it('should have buttons in correct order: skip prev, play/pause, skip next, stop', () => {
      player.show();
      
      const controls = player.container.querySelector('.elevenlabs-fp-controls');
      expect(controls).not.toBeNull();
      
      const buttons = controls.querySelectorAll('.elevenlabs-fp-btn');
      
      // Should have at least 4 buttons
      expect(buttons.length).toBeGreaterThanOrEqual(4);
      
      // Verify order by checking classes
      expect(buttons[0].classList.contains('elevenlabs-fp-skip-prev')).toBe(true);
      expect(buttons[1].classList.contains('elevenlabs-fp-play-pause')).toBe(true);
      expect(buttons[2].classList.contains('elevenlabs-fp-skip-next')).toBe(true);
      expect(buttons[3].classList.contains('elevenlabs-fp-stop')).toBe(true);
    });

    it('should position skip previous button before play/pause button', () => {
      player.show();
      
      const controls = player.container.querySelector('.elevenlabs-fp-controls');
      const children = Array.from(controls.children);
      
      const skipPrevIndex = children.indexOf(player.skipPreviousButton);
      const playPauseIndex = children.indexOf(player.playPauseButton);
      
      expect(skipPrevIndex).toBeLessThan(playPauseIndex);
    });

    it('should position skip next button after play/pause button', () => {
      player.show();
      
      const controls = player.container.querySelector('.elevenlabs-fp-controls');
      const children = Array.from(controls.children);
      
      const playPauseIndex = children.indexOf(player.playPauseButton);
      const skipNextIndex = children.indexOf(player.skipNextButton);
      
      expect(skipNextIndex).toBeGreaterThan(playPauseIndex);
    });

    it('should position skip next button before stop button', () => {
      player.show();
      
      const controls = player.container.querySelector('.elevenlabs-fp-controls');
      const children = Array.from(controls.children);
      
      const skipNextIndex = children.indexOf(player.skipNextButton);
      const stopIndex = children.indexOf(player.stopButton);
      
      expect(skipNextIndex).toBeLessThan(stopIndex);
    });
  });

  describe('Button Cleanup', () => {
    
    it('should set skip buttons to null when destroyed', () => {
      player.show();
      
      // Verify buttons exist
      expect(player.skipPreviousButton).not.toBeNull();
      expect(player.skipNextButton).not.toBeNull();
      
      // Destroy the player
      player.destroy();
      
      // Verify buttons are null
      expect(player.skipPreviousButton).toBeNull();
      expect(player.skipNextButton).toBeNull();
    });

    it('should remove container from DOM when destroyed', () => {
      player.show();
      
      // Verify container exists in DOM
      const containerBefore = document.getElementById('elevenlabs-floating-player');
      expect(containerBefore).not.toBeNull();
      
      // Destroy the player
      player.destroy();
      
      // Verify container is removed from DOM
      const containerAfter = document.getElementById('elevenlabs-floating-player');
      expect(containerAfter).toBeNull();
    });
  });

  describe('Skip Button Icon Methods', () => {
    
    it('should return valid SVG for getSkipPreviousIcon', () => {
      const icon = player.getSkipPreviousIcon();
      
      expect(icon).toContain('<svg');
      expect(icon).toContain('</svg>');
      expect(icon).toContain('viewBox');
    });

    it('should return valid SVG for getSkipNextIcon', () => {
      const icon = player.getSkipNextIcon();
      
      expect(icon).toContain('<svg');
      expect(icon).toContain('</svg>');
      expect(icon).toContain('viewBox');
    });

    it('should have different icons for skip previous and skip next', () => {
      const prevIcon = player.getSkipPreviousIcon();
      const nextIcon = player.getSkipNextIcon();
      
      // The path data should be different
      expect(prevIcon).not.toBe(nextIcon);
    });
  });

  describe('Skip Button Event Handlers', () => {
    
    it('should have onSkipPreviousClick bound to the instance', () => {
      expect(typeof player.onSkipPreviousClick).toBe('function');
    });

    it('should have onSkipNextClick bound to the instance', () => {
      expect(typeof player.onSkipNextClick).toBe('function');
    });

    it('should send SKIP_PREVIOUS message when skip previous button is clicked', async () => {
      player.show();
      
      // Click the skip previous button
      player.skipPreviousButton.click();
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Verify message was sent
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { type: 'skipPrevious' },
        expect.any(Function)
      );
    });

    it('should send SKIP_NEXT message when skip next button is clicked', async () => {
      player.show();
      
      // Click the skip next button
      player.skipNextButton.click();
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Verify message was sent
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { type: 'skipNext' },
        expect.any(Function)
      );
    });
  });

  describe('Skip Button Disabled States', () => {
    
    it('should disable skip buttons when status is idle', () => {
      player.show();
      
      player.updatePlaybackState({ status: 'idle', speed: 1.0, autoContinue: true });
      
      expect(player.skipPreviousButton.disabled).toBe(true);
      expect(player.skipNextButton.disabled).toBe(true);
    });

    it('should disable skip buttons when status is loading', () => {
      player.show();
      
      player.updatePlaybackState({ status: 'loading', speed: 1.0, autoContinue: true });
      
      expect(player.skipPreviousButton.disabled).toBe(true);
      expect(player.skipNextButton.disabled).toBe(true);
    });

    it('should enable skip buttons when status is playing', () => {
      player.show();
      
      player.updatePlaybackState({ status: 'playing', speed: 1.0, autoContinue: true });
      
      expect(player.skipPreviousButton.disabled).toBe(false);
      expect(player.skipNextButton.disabled).toBe(false);
    });

    it('should enable skip buttons when status is paused', () => {
      player.show();
      
      player.updatePlaybackState({ status: 'paused', speed: 1.0, autoContinue: true });
      
      expect(player.skipPreviousButton.disabled).toBe(false);
      expect(player.skipNextButton.disabled).toBe(false);
    });
  });
});
