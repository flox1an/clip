# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Open: primary audience not yet specified by the owner. Working assumption for design: people on a phone who want to capture a short vertical clip quickly, in TikTok fashion, without instructions.

## Product Purpose

"Clip" is an installable mobile web app (PWA, iOS Safari and Android Chrome) for recording short vertical videos from several takes, cutting them, and saving or sharing the result as a single MP4. Success: a first-time user records, trims, and saves a clip without help.

## Positioning

Everything happens on the device. Recordings and imports are processed in the browser. The user can download the finished file, share it through the system, or preview a signed Nostr video event after uploading the finished video to a Blossom server. Test events stay in the browser. Remote signer pairings can be reused on the same browser until disconnected.

## Operating Context

One-handed phone use, usually portrait, often outdoors or in changing light. Sessions are short. The page may be backgrounded or closed at any time; there is no server-side storage.

## Capabilities and Constraints

- Camera capture with front/back switch, tap or hold to record, multiple takes, self-timer, recording speed 0.5×–3×, colour filter (swipe or Filter button), music playing while recording.
- Hardware camera controls where the browser exposes them (mostly Android Chrome): tap to focus, exposure compensation, pinch zoom (zoom also on iOS 17+). Unavailable controls are simply absent; there is no post-processing substitute.
- Maximum film length: 60 seconds.
- Import of existing videos from the device gallery.
- Non-destructive editing: trim, split, reorder, delete clips, change clip speed, per-clip colour filter with strength (or for all clips), undo.
- Music: user uploads an audio file from the device (no built-in library; DRM-protected streaming songs cannot be used), chooses the song section, balances original sound and music.
- Export: one MP4 combining all clips, regardless of source resolution or orientation; output is portrait 9:16; filters and music are rendered in.
- Output destinations: download, Web Share, and optional Blossom upload with a signed Nostr video event preview. Clip runs without an app backend.
- Project lives only in the current session; nothing persists across reloads.
- UI languages: German and English, chosen from the device language (anything else gets English); `?lang=de|en` overrides. All texts live in `src/i18n/` (one file per language).
- Stack: Vite, vanilla JS, mediabunny for media decode/encode.

## Brand Commitments

- Name: "Clip".
- The owner asked explicitly for TikTok's look and interaction model: full-screen camera first, record button, segment progress bar, side tool rail, very simple handling.

## Evidence on Hand

No real user content, testimonials, or usage data. Do not invent any.

## Product Principles

1. Camera first: the app opens straight into recording.
2. One screen per job: capture, edit, share. Tools sit where the content is, never behind extra pages.
3. The whole frame is always visible while editing.
4. A failed export never loses the project.
5. Nothing leaves the device unless the user shares it.
