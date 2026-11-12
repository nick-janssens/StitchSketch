# StitchSketch

A mobile-first portrait-to-embroidery drawing PWA. It generates drawings with FLUX.2 Klein 4B through the StitchSketch Cloudflare Worker.

## Publish the app

1. Open the StitchSketch repository in GitHub.
2. Upload the changed project files and preserve their paths: `index.html`, `service-worker.js`, `README.md`, `styles/app.css`, `scripts/app.js`, `scripts/image-processing.js`, `scripts/export.js`, `manifest.webmanifest`, and `assets/icons/stitchsketch.svg`.
3. Commit the upload to the `main` branch. GitHub Pages publishes the app from the repository root.
4. Wait for Pages to finish publishing, then open the HTTPS site in Safari on the iPhone. The app shell is cached after its first online visit; drawing generation still requires an internet connection.

The old on-device line-art modules and MediaPipe files remain in the repository, but the current app does not load or cache them.

## Use StitchSketch

1. In Safari, choose **Share → Add to Home Screen** to install the PWA.
2. Choose a photo and adjust its crop.
3. Optionally enter an extra instruction for FLUX.2 Klein 4B. The built-in embroidery prompt works when the box is left blank.
4. Tap **Generate drawing**. The app sends the cropped photo to Cloudflare and requests a fixed 512 × 512 output. Generation needs an internet connection.
5. Tap **Save drawing to Photos** and choose **Save Image** in the iOS share sheet.

The upload notice explains that the cropped photo is sent to Cloudflare when **Generate drawing** is tapped. There is no separate consent checkbox. The access code is reused from the standalone FLUX test if saved in the same browser and site origin. Otherwise, enter it once under **AI access code**; it is saved in that browser's local storage.

## Deploy the Worker

The app calls `https://old-morning-4019.janssens-nick.workers.dev`. Deploy the updated `flux2-klein-test/worker.js` to that existing Cloudflare Worker. The Worker is locked to `@cf/black-forest-labs/flux-2-klein-4b`; it keeps the embroidery prompt and accepts the optional extra instruction. Keep `https://nick-janssens.github.io` in `DEFAULT_ORIGINS` or `ALLOWED_ORIGINS`.

## Files used by the app

- `index.html`: interface and PWA metadata
- `styles/app.css`: responsive styling
- `scripts/app.js`: photo crop, Worker request, connection settings and save flow
- `scripts/image-processing.js`: square crop and original-image preview
- `scripts/export.js`: PNG preparation and iOS share/download
- `manifest.webmanifest` and `service-worker.js`: installation and app-shell cache
- `assets/icons/stitchsketch.svg`: app icon