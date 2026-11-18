// Shared shapes, documented once. JSDoc only: no runtime code, so editors and `tsc --checkJs` can use them without a build step.
// Reference from other files with: /** @typedef {import('./types.js').Project} Project */

/**
 * One clip on the timeline. Source media are never mutated; a segment only points into one.
 * @typedef {object} Segment
 * @property {string} id
 * @property {string} sourceId
 * @property {number} duration Source length in seconds.
 * @property {number} start Trim start in source seconds.
 * @property {number} end Trim end in source seconds.
 * @property {number} speed One of SPEEDS.
 * @property {string} look Look id, see looks.js.
 * @property {number} strength 0–1.
 * @property {number} exposure −1…1.
 */

/**
 * @typedef {object} AudioMix
 * @property {string|null} musicId
 * @property {number} musicStart
 * @property {number} original Volume of the recorded audio, 0–1.
 * @property {number} music Volume of the music track, 0–1.
 */

/**
 * Immutable timeline state; every edit in project.js returns a new one.
 * @typedef {object} Project
 * @property {Segment[]} segments
 * @property {string|null} activeId
 * @property {AudioMix} audio
 * @property {Array<{segments: Segment[], activeId: string|null, audio: AudioMix}>} history Undo stack.
 */

/**
 * Anything that can sign a Nostr event: a browser extension, a remote signer (NIP-46) or a local key.
 * @typedef {object} Signer
 * @property {() => Promise<string>} getPublicKey
 * @property {(draft: object) => Promise<object>} signEvent
 */

/**
 * A connected Nostr identity plus where its posts go.
 * @typedef {object} NostrAccount
 * @property {Signer} signer
 * @property {string} pubkey Hex public key.
 * @property {string[]} outbox Relays to publish to.
 */
