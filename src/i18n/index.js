// UI text per language. Add a language: create <code>.js next to this file with the same keys and register it below.
import de from './de.js';
import en from './en.js';

const messages = { de, en };

export const LANGUAGES = Object.keys(messages);
// ?lang=en overrides the device language (handy for testing); otherwise the first supported device language, else English.
const requested = globalThis.location && new URLSearchParams(location.search).get('lang');
export const lang = [requested, ...(globalThis.navigator?.languages ?? [])].map(code => code?.slice(0, 2).toLowerCase()).find(code => LANGUAGES.includes(code)) ?? 'en';
if (globalThis.document) document.documentElement.lang = lang;

export function t(key, vars) {
  const text = messages[lang][key] ?? messages.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, name) => vars[name]) : text;
}
export const formatNumber = (value, options) => value.toLocaleString(lang, options);
