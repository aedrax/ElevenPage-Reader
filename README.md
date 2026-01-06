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
  * **Variable Speed:** Increase or decrease playback speed (0.5x to 3.0x).  
  * **Click-to-Read:** Hover over any paragraph to see a "Play" button. Clicking it instantly pauses current audio and jumps reading to that specific paragraph.  
* **Voice Selection:** Fetches your saved voices directly from your ElevenLabs library for easy switching via the extension popup.

## **🛠️ Prerequisites**

Before installing, ensure you have:

1. **Google Chrome** (or a Chromium-based browser like Brave or Edge).  
2. An **ElevenLabs Account** with an active API Key.  
   * *Note: Word-level highlighting requires the ElevenLabs API to return timestamp information. Ensure your tier supports the required latency/features.*

## **🚀 Installation (Developer Mode)**

Since this is a local project, you will install it as an "Unpacked Extension."

1. **Clone or Download** this repository to your local machine.  
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer mode** in the top right corner.  
4. Click the **Load unpacked** button.  
5. Select the `dist` or root folder of this project (depending on your build process).  
6. The extension icon should now appear in your browser toolbar.

## **⚙️ Configuration**

1. Click the **ElevenPage Reader icon** in your toolbar to open the popup.  
2. Go to the **Settings** tab (gear icon).  
3. Paste your **ElevenLabs API Key**.  
4. Click **Save**. The extension will immediately fetch and populate your available voices.

## **📖 Usage Guide**

### **Basic Controls**

* **Start Reading:** Open the popup and click "Play," or use the keyboard shortcut (`Alt+P` by default).  
* **Change Voice:** Select a different voice from the dropdown in the popup. The change will apply to the next generated audio segment.  
* **Speed:** Use the `+` / `-` buttons in the floating player or popup to adjust speed.

### **Paragraph Jumping**

When viewing a web page:

1. Hover your mouse over any block of text.  
2. A small **Play icon** (▶) will appear to the left of the paragraph.  
3. Click the icon. If audio is already playing, it will stop and immediately restart from this new paragraph.

## **🏗️ Technical Architecture**

This extension uses **Manifest V3**.

* `content_script.js`: Handles DOM parsing. It wraps text nodes in `<span>` tags to enable granular highlighting without breaking page layout. It injects the floating control overlay.  
* `background.js`: Manages the ElevenLabs API calls. It handles the streaming response to buffer audio and process **alignment data** (timestamps) for word-level sync.  
* `popup.html/js`: User interface for settings, voice selection, and API key management.  
* `offscreen.html` (Optional): Used if audio playback requires DOM access that the Service Worker cannot provide directly, or for handling complex WebSocket streams for lower latency.

### **A Note on Highlighting**

To achieve word-level highlighting, the extension requests `with_timestamps=true` (or uses the WebSocket endpoint) from ElevenLabs. The returned JSON data maps character indices to time. The Content Script uses this map to toggle CSS classes on specific word spans in sync with the `Audio` element's `currentTime`.

## **📦 Project Structure**

```
.  
├── manifest.json       # Extension configuration  
├── icons/              # App icons  
├── src/  
│   ├── background/     # Service worker logic (API calls)  
│   ├── content/        # DOM manipulation & highlighting logic  
│   ├── popup/          # UI for the extension window  
│   └── styles/         # CSS for highlights and floating player  
├── lib/                # Utility scripts (API wrappers)  
└── README.md
```

## **🤝 Contributing**

Contributions are welcome!

1. Fork the project.  
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes.  
4. Push to the branch.  
5. Open a Pull Request.

## **📄 License**

Distributed under the MIT License. See `LICENSE` for more information.

---

**Disclaimer:** This project is not affiliated with ElevenLabs. It is a third-party client using their public API. Usage of the API will incur costs against your ElevenLabs quota.