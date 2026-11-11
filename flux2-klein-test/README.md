# StitchSketch · FLUX.2 Klein 4B test

This is a standalone test app in `flux2-klein-test/`. It leaves the existing StitchSketch app and `informative-drawings-test/` unchanged. The browser page is static HTML, CSS and JavaScript. A small Cloudflare Worker calls the hosted `@cf/black-forest-labs/flux-2-klein-4b` model; no Python, Node.js, local model download or paid inference API is used by this project.

## Important privacy and connectivity note

The selected photo is resized on the device to a maximum dimension of 480 px, converted to JPEG and then sent to the Cloudflare Worker. The Worker forwards it to FLUX.2 Klein 4B and returns the generated PNG. Cloudflare labels this model “zero data retention,” but the photo leaves the phone/computer and is processed by Cloudflare. Do not use a photo unless you are comfortable with that. The browser app does not save the photo or send it to GitHub Pages. Generation requires an internet connection; only the app shell is cached for offline opening.

The app needs an access code because the Worker uses your Cloudflare AI quota. The code must be entered in the browser to send a request, so it is not a strong authentication system and could be shared or extracted by someone who has the app and code. Do not publish the access code or put it in these files. If you suspect it has been shared, replace the `APP_ACCESS_KEY` Worker secret.

## 1. Deploy the Worker in Cloudflare

You need a Cloudflare account. No command-line tools or software installation are needed.

1. Sign in to the Cloudflare dashboard and open **Workers & Pages**.
2. Choose **Create application** and create a basic Worker (for example, **Start with Hello World**). Give it a name such as `stitchsketch-flux-test`, then deploy it.
3. Open the new Worker and choose **Edit Code**. Replace the editor contents with all the text from this folder's `worker.js`, then choose **Deploy**.
4. Open the Worker's **Settings → Bindings**. Add a **Workers AI** binding with the variable name exactly `AI`, then deploy the change. The code calls the model through `env.AI`.
5. In **Settings → Variables and Secrets**, choose **Add**. Select **Secret**, set the variable name to `APP_ACCESS_KEY`, and enter a long access code you create. Save/deploy.
6. The Worker allows these origins by default: `https://nick-janssens.github.io`, `http://127.0.0.1:8766` and `http://localhost:8766`. If your GitHub Pages site uses a different hostname, add a plaintext variable named `ALLOWED_ORIGINS` containing a comma-separated list, for example `https://your-name.github.io,http://127.0.0.1:8766,http://localhost:8766`, then deploy. Keep the local origins if you want to test from your computer too.
7. Copy the Worker URL from its Overview page. It looks like `https://stitchsketch-flux-test.<your-subdomain>.workers.dev`.

Cloudflare's official guides: [Workers AI from the dashboard](https://developers.cloudflare.com/workers-ai/get-started/dashboard/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## 2. Run the test locally in Chrome

1. Open `flux2-klein-test` in File Explorer.
2. Double-click `run-test.cmd`. A PowerShell window will serve only this folder at `http://127.0.0.1:8766/`. The script does not install anything or change Windows settings.
3. Open `http://127.0.0.1:8766/` in Chrome.
4. Expand **Cloudflare Worker connection**. The Worker URL is prefilled. Enter the `APP_ACCESS_KEY` you created, then choose **Save connection**. The URL and code are saved in this browser's local storage, so it should only be necessary once on that device/browser.
5. Choose a photo and output size. The app automatically uses its embroidery-focused defaults. Leave **Extra instruction** blank for the standard result, or add a short optional preference. Check the photo-upload notice and choose **Generate drawing**.
6. Compare the original and FLUX result side by side. Select **Save drawing as PNG** to download it.
7. To stop the local server, focus its PowerShell window and press **Ctrl+C**.

The local page must be served over HTTP rather than opened by double-clicking `index.html`; the included PowerShell server avoids `file://` restrictions. For errors, use **Check connection** first. A CORS error usually means the page's exact origin is missing from `ALLOWED_ORIGINS`. A 401 means the access code is wrong. Check the Worker logs and Cloudflare Workers AI usage if generation returns a model/quota error.

## 3. Publish the app for iPhone

1. Upload the **contents** of this folder to your GitHub repository, preserving the folder name `flux2-klein-test`. Do not upload any access code or secret.
2. With the existing GitHub Pages site at `https://nick-janssens.github.io/StitchSketch/`, the app will be at `https://nick-janssens.github.io/StitchSketch/flux2-klein-test/` after Pages finishes publishing.
3. Open that HTTPS URL in Safari on the iPhone, enter the access code, choose **Save connection**, then use **Share → Add to Home Screen**. Open the installed app and save the code there too if the iPhone keeps separate website storage for the Safari tab and home-screen app.
4. The app shell can open offline after it has been loaded once, but generating a drawing still needs the internet and the Cloudflare Worker.

If you use a different Pages account/site, add its exact origin (scheme and hostname, without a path) to the Worker `ALLOWED_ORIGINS` variable and deploy again.

## What this POC does

- Keeps the full photo framing and aspect ratio when preparing the reference: the browser scales it down proportionally, never stretches it, and sends an image smaller than 512 × 512 as required by this model endpoint.
- Requests an output size of 512, 768 or 1024 px on the longest side and calculates the other dimension from the original aspect ratio. Model dimensions are rounded to multiples of 16. Exceptionally panoramic/tall photos may be enlarged slightly to meet the model's 256 px minimum dimension while keeping their proportions.
- Supplies a detailed embroidery-focused baseline prompt automatically, designed to work without any extra input. An optional instruction can be appended when desired. The baseline supports one or multiple people and retains accessories such as glasses only when visible in the photo.
- Shows total time from local image preparation through result download, reports the returned size, and downloads the generated PNG.
- Keeps the existing Informative Drawings model test available in its original folder; this app does not modify or replace it.

FLUX is an image generation/editing model, not a deterministic edge tracer. It can alter identity, anatomy, pose, glasses or clothing despite the prompt. This proof of concept lets you judge those changes on your photos. The result may look more illustrative, but it is not guaranteed to be a faithful embroidery pattern.

Cloudflare documents a free allocation of 10,000 Workers AI Neurons per day, with requests stopping after the limit on its Free plan. At the published prices of 5.37 Neurons per 512 × 512 input tile and 26.05 per output tile, a sub-512 input plus one output tile is approximately 31 Neurons, while a 4-tile output is around 110 Neurons. That is roughly 320 or 90 generations per day, respectively, before other account use; actual tile billing can depend on model sizing and aspect ratio. Check the dashboard's usage page for actual consumption. [Model details and input limits](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/) · [Model privacy and output](https://developers.cloudflare.com/ai/models/%40cf/black-forest-labs/flux-2-klein-4b/) · [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
