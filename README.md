# StitchSketch

A browser-only portrait outline maker. Photo processing happens locally in Canvas; no photos are uploaded or sent to an external API.

## Publish from the GitHub website

1. Open the StitchSketch repository in GitHub.
2. Choose **Add file → Upload files**.
3. From this folder, upload the project files and preserve their folders:
   - index.html, manifest.webmanifest, service-worker.js, .nojekyll
   - styles/app.css
   - all six files in scripts/
   - assets/icons/stitchsketch.svg
   - all files in assets/mediapipe/ (about 19 MB: models, runtime and license)
4. Commit the upload to the main branch.
5. Open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select main and /(root), then save.
6. Wait for the Pages deployment to finish. The site address is shown in **Settings → Pages**. Open it once in Safari on your iPhone while online.

If GitHub's upload screen does not preserve folders when dropping them, upload each folder's files separately using **Add file → Upload files**, or create the same paths with **Add file → Create new file**.

## Install on iPhone and save a drawing

1. In Safari, open the published HTTPS site.
2. Tap **Share → Add to Home Screen → Add**.
3. Open StitchSketch from its Home Screen icon while online. The first visit downloads and caches the app, portrait segmentation model and face-landmark model (about 19 MB total) for offline use.
4. Choose a portrait. Adjust zoom and framing, then tune Detail and Line strength.
5. Tap **Save drawing to Photos**. In the iOS share sheet, choose **Save Image**. If Safari downloads the PNG instead, open the download and use **Share → Save Image**.

Background removal and facial landmarks use bundled MediaPipe models locally in the browser. Face landmarks guide the face, eye, eyebrow and lip contours. The app converts selected photo contours into simplified, smoothed paths; this reduces photographic texture but cannot reproduce an artist's judgment for every image. Models and runtime are cached for offline use after the updated app assets are downloaded.

The app creates a 600 by 600 pixel PNG. The crop is square. The photo and generated drawing remain in the browser unless you choose to save/share them. For best results, use a clear portrait with visible contrast.

## Files

- index.html: app interface and PWA metadata
- styles/app.css: responsive layout and styling
- scripts/image-processing.js and scripts/image-processing-worker.js: crop and outline conversion
- scripts/segmentation.js and scripts/face-landmarks.js: local foreground mask and facial feature paths
- scripts/export.js: PNG preparation and iOS share/download
- scripts/app.js: user interface behavior
- manifest.webmanifest and service-worker.js: installation and offline cache
- assets/icons/stitchsketch.svg: app icon
- assets/mediapipe/: local person and face models, WebAssembly runtime and license
