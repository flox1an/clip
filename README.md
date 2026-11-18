# Clip

A mobile-first web app (PWA) for recording short vertical videos, cutting them and publishing them. It runs entirely in the browser: no app backend, no accounts, nothing leaves your device unless you share it.

## Features

- **Record** with front or back camera, tap or hold to record, multiple takes, self-timer, speed 0.5×–3×, live colour looks, and hardware camera controls (focus, exposure, zoom) where the browser offers them.
- **Import** existing videos from the gallery.
- **Edit non-destructively:** trim, split, reorder, delete, per-clip speed and look, undo.
- **Music:** add your own audio file, pick the section, balance it against the original sound.
- **Export** one portrait 9:16 MP4 (max. 60 s) with looks and music rendered in. Download it or share it through the system share sheet.
- **Publish to Nostr** (optional): upload the video to [Blossom](https://github.com/hzrd149/blossom) servers and publish a signed video event (kinds 34235/34236). Signing works with a NIP-07 browser extension or a NIP-46 remote signer (QR code, `nostrconnect://` link or `bunker://` link).
- German and English UI, chosen from the device language; `?lang=de|en` overrides it.

## Getting started

Requires Node.js 20 or newer.

```sh
npm install
npm run dev      # dev server on http://localhost:5173 (--host 0.0.0.0, so phones on your network can reach it)
npm test         # unit tests (node --test)
npm run build    # production build in dist/
```

Camera access needs a secure context: `localhost` or HTTPS. To try the app on a phone, serve the dev server over HTTPS (for example with a tunnel) or deploy the build.

### Docker

```sh
docker build -t clip .
docker run --rm -p 8080:80 clip
```

The image serves the static build with nginx; see `nginx.conf`.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main.js` | App shell: camera, editor and result screens |
| `src/project.js` | Immutable timeline model (segments, undo) |
| `src/looks.js` | Colour looks, one WebGL shader for camera, preview and export |
| `src/export.js`, `src/media.js` | Decoding and MP4 export via [mediabunny](https://mediabunny.dev) |
| `src/recorder.js`, `src/camera-controls.js` | Camera capture and hardware controls |
| `src/nostr/` | Signer pairing, Blossom upload, event building and publishing (`index.js`), plus the publish sheet UI (`sheet.js`) |
| `src/i18n/` | UI text, one file per language |
| `src/types.js` | Shared JSDoc type definitions |
| `public/` | Manifest, icons and service worker |
| `test/` | Unit tests |

`PRODUCT.md` and `DESIGN.md` describe the product intent and the visual design.

## Adding a language

Create `src/i18n/<code>.js` with the same keys as `en.js`, then register it in `src/i18n/index.js`. A test fails if a key is missing.

## Privacy

Recordings and imports are processed locally. The only network traffic is what you start yourself: Nostr relays and Blossom servers when you publish, and the relays used for remote-signer pairing. Default relays are defined at the top of `src/nostr/index.js`.

## License

[MIT](LICENSE)
