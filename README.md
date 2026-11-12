# StitchSketch

A mobile-first portrait-to-embroidery drawing PWA. Choose between AI-generated line art using Cloudflare Workers AI and the original on-device line-drawing pipeline.

## Publish from the GitHub website

1. Open the StitchSketch repository in GitHub.
2. Upload the project files and preserve their folders: `index.html`, `manifest.webmanifest`, `service-worker.js`, `.nojekyll`, all files in `styles/` and `scripts/`, `assets/icons/`, and `assets/mediapipe/`.
3. Commit the upload to the `main` branch. In **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/(root)`, then save.
4. Wait for Pages to publish. The site address appears in **Settings → Pages**. Open it in Safari on the iPhone while online.

## Use the app

1. Install it from Safari with **Share → Add to Home Screen**.
2. Choose a photo and adjust its crop.
3. Choose a model: **FLUX.2 Klein 4B** is the default, **Klein 9B** is available for comparison, and **On-device line drawing** stays local. FLUX output is always 512 × 512. The optional extra-instructions box appears only for the FLUX models. Review the upload notice, check the consent box, and tap **Generate AI drawing** to send the cropped photo to your Cloudflare Worker.
4. The access code is reused from the standalone FLUX test when it was saved in the same browser and site origin. Otherwise, enter it once under **AI access code**. The code is stored in this browser's local storage.
5. Choose **On-device line drawing** to use the previous local pipeline instead. That mode keeps the image on the device and works offline after the PWA and its local models have been cached. Its style, detail, strength and background controls apply only to this mode.
6. **Save drawing to Photos** opens the iOS share sheet; choose **Save Image**.

The AI photo transfer is opt-in and happens only after consent and an explicit Generate tap. The local mode does not send photos anywhere. The AI modes do not work offline.

## AI models and quota

- **FLUX.2 Klein 4B** is the default AI model. It is the lower-cost, faster option.
- **FLUX.2 Klein 9B** is included for comparison. Cloudflare describes it as improved in quality over 4B, but the actual embroidery result needs to be judged on your photos. Its published pricing is metered by megapixels and is much higher than 4B. The main app always requests 512 × 512 to keep costs down. The current Workers AI Free allocation is 10,000 Neurons per day; on the Free plan requests stop when the allocation is exhausted, while Paid-plan usage beyond the free allocation is billed.
- The existing **On-device line drawing** is still available and is the offline/private option.

Cloudflare model details: [FLUX.2 Klein 4B](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/), [FLUX.2 Klein 9B](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-9b/), [Workers AI pricing and free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## Deploy the Worker update

The app calls the Worker at `old-morning-4019.janssens-nick.workers.dev`. Deploy the updated `flux2-klein-test/worker.js` to that existing Cloudflare Worker. The Worker keeps 4B as its default and allowlists Klein 9B for the model selector. The GitHub Pages origin `https://nick-janssens.github.io` must remain in `DEFAULT_ORIGINS` or `ALLOWED_ORIGINS`.

## Local processing files

The on-device option uses bundled MediaPipe person and face models locally in the browser. The app shell and model files are cached for offline use after the first online load (about 19 MB). Its output is a 600 × 600 PNG. The main app requests a fixed 512 × 512 image from FLUX.

## Files

- `index.html`: app interface, AI consent and PWA metadata
- `styles/app.css`: responsive layout
- `scripts/app.js`: model selection, local and AI generation flows
- `scripts/image-processing.js` and `scripts/image-processing-worker.js`: crop and on-device outline conversion
- `scripts/segmentation.js` and `scripts/face-landmarks.js`: local foreground mask and facial feature paths
- `scripts/export.js`: PNG preparation and iOS share/download
- `manifest.webmanifest` and `service-worker.js`: installation and offline cache
- `assets/mediapipe/`: local segmentation and face models, WebAssembly runtime and license