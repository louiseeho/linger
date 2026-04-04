# Linger

A Chrome extension for Pinterest that helps you notice what you love when you save pins (with Gemini-powered labels and details).

## Gemini API key (required)

The extension **will not** call Gemini until a key is available to the background service worker.

1. Copy the example env file and add your key from [Google AI Studio](https://aistudio.google.com/apikey):

   ```bash
   cp .env.example .env
   ```

   On Windows (PowerShell): `Copy-Item .env.example .env`

   Edit `.env` and set:

   ```env
   LINGER_GEMINI_API_KEY=your_key_here
   ```

2. **Generate the config file the extension reads** (this repo gitignores `.env` and `linger-config.local.json`):

   ```bash
   npm run sync-env
   ```

   That writes `linger-config.local.json` next to `manifest.json`. Reload the extension in `chrome://extensions` after running this (or after changing the key).

3. Load the extension **unpacked** pointing at this folder. If Pinterest was already open, refresh those tabs.

Without `npm run sync-env`, there is no `linger-config.local.json` (unless you create it manually with the same shape), and AI features on Pinterest will fail until you do.

## Optional: key in Chrome storage

If `linger-config.local.json` is missing, the background script can fall back to `chrome.storage.local` → `linger_gemini_api_key`, but the intended developer flow is `.env` + `npm run sync-env`.
