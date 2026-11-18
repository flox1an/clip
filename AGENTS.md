# Conventions

Guidance for anyone, human or AI agent, changing this repo. See `README.md` for what the project is and `PRODUCT.md` / `DESIGN.md` for product and visual intent.

## Language

- Everything in the repo is **English**: code comments, identifiers, commit messages, docs, PR text, test names.
- The only exception is user-facing text, which lives in `src/i18n/<lang>.js` (German and English). Never hard-code UI strings in other files.
- Write with correct diacritics in German UI text (ä, ö, ü, ß).

## Commits

- One logical change per commit. Subject in imperative mood, sentence case, no type prefix, no trailing period, about 72 characters or fewer: `Keep Blossom uploads alive when Safari drops the connection`.
- Say what changed and why in the subject. Add a body only when the reason is not obvious from the diff.
- Never commit secrets, deploy tokens, internal hostnames or personal paths. Private deploy config stays in ignored files (see `.gitignore`).

## Code style

- Vanilla ES modules, no framework, no TypeScript. Vite builds; there is no other build step.
- 2-space indent, single quotes, semicolons, `const` by default, arrow functions for small helpers.
- Comments explain *why* (a browser quirk, a protocol constraint), not *what*. Keep them short.
- Shared shapes are documented once in `src/types.js` (JSDoc). Reference them with `import('./types.js').Name` instead of redefining them.
- DOM is built with the `html` helper from `src/ui.js`. Strings shown to users go through `t()`.

## Architecture rules

- `src/project.js` is a pure, immutable timeline model: every edit returns a new project and never mutates its input. No DOM, no I/O.
- Source media are never modified; segments only point into them.
- One WebGL renderer (`src/looks.js`) draws looks for camera, preview and export, so all three match. Do not add a second code path for looks.
- Nostr logic (`src/nostr/index.js`) is separate from its UI (`src/nostr/sheet.js`). Keep protocol code free of DOM access.
- Network calls must be user-initiated (publish, pairing). The app has no backend and no analytics.
- A failed export or upload must never lose the project (see product principles in `PRODUCT.md`).

## Tests

- `npm test` runs `node --test` on `test/*.test.js`. Run it before every commit; it must pass.
- Add or update a test with every behaviour change in pure logic (project model, trim, nostr, export sizing, i18n).
- `test/i18n.test.js` fails when a `t('key')` used in `src/` is missing in any language, or the language files have different keys. Add new keys to **all** languages.
- Run `npm run build` after changing imports or moving files; tests do not cover the bundle.
- Camera, WebGL and iOS Safari behaviour cannot be unit tested. Verify those manually on a real phone.

## Adding things

- **New language:** create `src/i18n/<code>.js` with the keys of `en.js` and register it in `src/i18n/index.js`.
- **New shared type:** add it to `src/types.js`.
- **New dependency:** avoid it unless the standard library or the platform cannot do the job; prefer small, maintained packages and say why in the commit.
