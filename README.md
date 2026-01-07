# **ElevenPage Reader**

**ElevenPage Reader** is a Chrome Extension that transforms any web page into an immersive audio experience using the ultra-realistic AI voices from [ElevenLabs](https://elevenlabs.io/).

This extension integrates directly with your ElevenLabs account, allowing you to listen to articles, blogs, and documentation with precision highlighting and full playback control.

## **✨ Features**

* **ElevenLabs Integration:** Connects directly to the ElevenLabs API using your personal API key.  
* **Real-time Highlighting:**  
  * **Sentence Level:** Highlights the full sentence currently being read.  
  * **Word Level:** Applies a distinct highlight style to the exact word being spoken in real-time.  
* **Smart Playback Control:**  
  * **Play/Pause:** Standard global controls.  
  * **Skip Next/Previous:** Navigate between paragraphs. Skip previous restarts the current paragraph if more than 3 seconds in, otherwise goes to the previous paragraph.
  * **Variable Speed:** Increase or decrease playback speed (0.5x to 3.0x).  
  * **Click-to-Read:** Hover over any paragraph to see a "Play" button. Clicking it instantly pauses current audio and jumps reading to that specific paragraph.  
  * **Auto-Continue:** Automatically continues to the next paragraph when the current one finishes.
* **Voice Selection:** Fetches your saved voices directly from your ElevenLabs library for easy switching via the extension popup.

## **🛠️ Prerequisites**

Before installing, ensure you have:

1. **Google Chrome** (or a Chromium-based browser like Brave or Edge).  
2. An **ElevenLabs Account** with an active API Key.  
   * Get your API key here: **[ElevenLabs API Keys](https://elevenlabs.io/app/developers/api-keys)**
   * When creating your API key, ensure the following permissions are enabled:
     * **"Text to Speech" section has "Access"** - Required for generating audio from text.
     * **"Voices" section has "Read" access** - Required for the extension to fetch your available voices.
   * *Note: Word-level highlighting requires the ElevenLabs API to return timestamp information. Ensure your tier supports the required latency/features.*

## **🚀 Installation**

### **Option 1: Download from Releases (Recommended)**

1. Go to the [Releases page](https://github.com/aedrax/elevenpage-reader/releases).
2. Download the latest `elevenpage-reader-extension.zip` file.
3. Extract the ZIP file to a folder on your computer.
4. Open Chrome and navigate to `chrome://extensions`.
5. Toggle **Developer mode** in the top right corner.
6. Click the **Load unpacked** button.
7. Select the extracted folder.
8. The extension icon should now appear in your browser toolbar.

### **Option 2: Build from Source (For Developers)**

1. **Clone or Download** this repository to your local machine.  
2. **Install dependencies and build:**
   ```bash
   npm install
   npm run build
   ```
3. Open Chrome and navigate to `chrome://extensions`.
4. Toggle **Developer mode** in the top right corner.  
5. Click the **Load unpacked** button.  
6. Select the root folder of this project.  
7. The extension icon should now appear in your browser toolbar.

### **Development**

For development with auto-rebuild on changes:
```bash
npm run build:watch
```

Run tests:
```bash
npm test
```

## **⚙️ Configuration**

1. Click the **ElevenPage Reader icon** in your toolbar to open the popup.  
2. Go to the **Settings** tab (gear icon).  
3. Paste your **ElevenLabs API Key**.  
4. Click **Save**. The extension will immediately fetch and populate your available voices.

## **📖 Usage Guide**

### **Floating Player Controls**

When you visit a page with readable content, a floating player appears with these controls:

* **Skip Previous (⏮):** Go to previous paragraph, or restart current if more than 3 seconds in
* **Play/Pause (▶/⏸):** Toggle playback
* **Skip Next (⏭):** Advance to next paragraph
* **Stop (⏹):** Stop playback completely
* **Speed:** Dropdown to adjust playback speed (0.5x - 3.0x)

### **Paragraph Jumping**

When viewing a web page:

1. Hover your mouse over any block of text.  
2. A small **Play icon** (▶) will appear to the left of the paragraph.  
3. Click the icon. If audio is already playing, it will stop and immediately restart from this new paragraph.

## **🏗️ Technical Architecture**

This extension uses **Manifest V3**.

* `src/content/`: Content scripts for DOM parsing, text wrapping, highlighting, and the floating player UI. Bundled with esbuild.
* `src/background/service-worker.js`: Manages the ElevenLabs API calls, playback state, and audio coordination.
* `src/popup/`: User interface for settings, voice selection, and API key management.  
* `src/background/offscreen.js`: Handles audio playback (Service Workers cannot access Audio API directly).

### **Build Process**

The project uses esbuild to bundle content scripts:

```bash
npm run build        # One-time build
npm run build:watch  # Watch mode for development
```

Entry point: `src/content/content-entry.js` -> `dist/content-entry.js`

### **A Note on Highlighting**

To achieve word-level highlighting, the extension requests `with_timestamps=true` from ElevenLabs. The returned JSON data maps character indices to time. The Content Script uses this map to toggle CSS classes on specific word spans in sync with the audio's `currentTime`.

## **📦 Project Structure**

```
.  
├── manifest.json       # Extension configuration  
├── esbuild.config.js   # Build configuration
├── icons/              # App icons  
├── src/  
│   ├── background/     # Service worker logic (API calls, audio coordination)  
│   ├── content/        # DOM manipulation, highlighting, floating player (bundled)  
│   ├── popup/          # UI for the extension window  
│   └── styles/         # CSS for highlights and floating player  
├── lib/                # Utility scripts (API wrappers, storage)
├── dist/               # Bundled output (generated by build)
├── tests/              # Test files
└── README.md
```

## **🔄 CI/CD**

This project uses GitHub Actions for continuous integration:

[![Build Extension](https://github.com/aedrax/elevenpage-reader/actions/workflows/build.yml/badge.svg)](https://github.com/aedrax/elevenpage-reader/actions/workflows/build.yml)

On every push and pull request to `main`:
- Dependencies are installed
- Extension is built with esbuild
- Tests are run with Vitest
- Build artifacts are uploaded and available for download

## **🤝 Contributing**

Contributions are welcome!

1. Fork the project.  
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes.  
4. Push to the branch.  
5. Open a Pull Request.

The CI pipeline will automatically build and test your changes.

## **📄 License**

Distributed under the MIT License. See `LICENSE` for more information.

---

**Disclaimer:** This project is not affiliated with ElevenLabs. It is a third-party client using their public API. Usage of the API will incur costs against your ElevenLabs quota.
