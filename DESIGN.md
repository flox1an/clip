---
name: Clip
colors:
  record-red: "#fe2c55"
  record-red-text: "#ff5c7a"
  ground: "#000000"
  raised: "#1c1c1e"
  ink: "#ffffff"
  veil: "rgb(255 255 255 / 0.14)"
  muted: "rgb(255 255 255 / 0.66)"
typography:
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Segoe UI', system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 500
  label:
    fontSize: 11px
    fontWeight: 600
  caption:
    fontSize: 13px
    fontWeight: 600
  title:
    fontSize: 20px
    fontWeight: 700
rounded:
  pill: 999px
  sheet: 16px
  clip: 7px
  stage: 10px
components:
  button-primary:
    backgroundColor: "{colors.record-red}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: 44px
  button-secondary:
    backgroundColor: "{colors.veil}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: 44px
  shutter:
    backgroundColor: "{colors.record-red}"
    size: 84px
---

# Design System: Clip

## Overview

TikTok's capture-and-edit model, played straight at the owner's request. The video is the interface: black ground, full-bleed media, white glyph controls floating on the picture with soft drop shadows. One hot red marks recording, selection, and the primary action. No cards, no panels; controls sit directly on or beside the content.

## Colors

### Primary
- **Record red** `#fe2c55`: shutter, segment bar fill, primary pills, trim frame, active toggles. Never decorative.
- **Record red text** `#ff5c7a`: red used as text or icon on black (Löschen, toast actions); passes 4.5:1.

### Neutral
- **Ground** `#000`, **Raised** `#1c1c1e` (sheets, toasts), **Veil** white 14 % (secondary pills, chips track), **Muted** white 66 % (supporting copy).

### Named Rules
- Red means "this records, this is selected, or this is the next step". Nothing else is red.

## Typography

One system sans. Product UI, fixed sizes: 11 px/600 tool labels, 13–15 px body and buttons, 17–22 px titles. Times and durations use tabular numerals.

## Layout

Phone column, max `max(430px, 56.25dvh)` wide, centred on desktop. Safe-area insets on every edge. Camera: segment bar top, tool rail top-right, record cluster bottom. Editor: top bar, the full 9:16 frame contained in the remaining height (container query), clip strip, trim bar for the selected clip, tool row. Result: full-bleed video with a bottom action scrim.

## Elevation & Depth

Flat. Legibility over video comes from `drop-shadow(0 1px 2px rgb(0 0 0 / .55))` on glyphs and text-shadow on labels. Sheets and toasts carry a soft offset shadow.

## Shapes

Circles for record and confirm, pills for buttons, 7 px clip tiles, 16 px top-rounded bottom sheets, 6 px outer corners on trim handles.

## Components

- **Shutter**: 84 px red disc in a translucent red ring. Recording: ring scales 1.2, disc morphs to a 28 px rounded square (250 ms, ease-out).
- **Segment bar**: 6 px, one red span per clip with 2 px gaps; the live take grows in place.
- **Tool rail / tool row**: icon above 11 px label. Active state turns the icon red and shows the value (`2×`, `3 s`).
- **Trim bar**: source filmstrip, dimmed outside the cut, red frame and grip handles, white playhead.
- **Sheet**: native `<dialog>` as a bottom sheet; red confirm, veil cancel.
- **Toast**: top-centre, optional red text action (Rückgängig).
- **Panel**: bottom panel over the lower screen (filter, music), translucent near-black, 16 px top corners; the scrim above closes it so the picture stays visible.
- **Filter strip**: 62 px rounded thumbnails of the live frame with each look, white ring on the selected one, `Stärke` slider above.
- **Music pill**: top-centre pill with note glyph and song name; music panel shows a waveform with a red window for the song section and two level sliders.
- **Focus ring**: tap on the viewfinder shows a 72 px white ring with a vertical white exposure slider (sun glyph) beside it, fading after 3 s. Pinch shows a small zoom pill above the shutter. Both appear only when the camera reports the capability.
- Icons are sized through `font-size` on their button (glyphs 24–30 px); those values are icon sizes, not type steps.

## Looks

Colour looks are a 3×3 sRGB matrix plus offset, an optional S-shaped contrast curve, then split toning (colour into shadows and highlights), a lifted black point, film grain and vignette (`src/looks.js`). One WebGL shader draws them for camera, editor preview, and export, so all three match. Grain sits on a fixed 540×960 grid of the frame and changes 24 times a second. Looks with a curve (Noir) show an Exposure slider that moves the curve's steepest point (mid-grey): right brightens, left darkens.

## Do's and Don'ts

- Do keep the whole frame visible while editing.
- Do put every clip tool on the editor screen; no sub-pages.
- Don't add a second accent colour or card containers.
- Don't use native video controls; tap the picture to play and pause.
