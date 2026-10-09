import type { Language } from '../types';
import type { Lang3 } from '../components/LangSwitcher';

const LANGUAGE_STORAGE_KEY = 'hakcc-language';
const LANGUAGE_CHANGE_EVENT = 'hakcc-language-change';
// Retain explicit choices within this session when browser storage is blocked.
let sessionPreference: Lang3 | undefined;

function supportedLanguage(value: string | null | undefined): Lang3 | undefined {
  const parts = value?.toLowerCase().replaceAll('_', '-').split('-');
  if (!parts) return;
  if (parts[0] === 'en') return 'en';
  if (parts[0] !== 'zh') return;
  if (parts.includes('hans')) return 'zh-CN';
  if (parts.includes('hant') || parts.some(p => ['tw', 'hk', 'mo'].includes(p))) return 'zh-TW';
  return 'zh-CN';
}

function readStoredLanguage(): Lang3 | undefined {
  if (sessionPreference) return sessionPreference;
  try {
    if (typeof window !== 'undefined') return supportedLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch { /* Storage may be disabled; browser detection remains available. */ }
}

export function readPublicLanguage(fallback: Lang3 = 'zh-CN'): Lang3 {
  const stored = readStoredLanguage();
  if (stored) return stored;
  if (typeof navigator !== 'undefined') {
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const language of languages) {
      const matched = supportedLanguage(language);
      if (matched) return matched;
    }
  }
  return fallback;
}

export function readAppLanguage(fallback: Language = 'zh'): Language {
  return readPublicLanguage(fallback === 'en' ? 'en' : 'zh-CN') === 'en' ? 'en' : 'zh';
}

export function saveLanguagePreference(lang: Language | Lang3) {
  const normalized = supportedLanguage(lang)!;
  sessionPreference = normalized;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    sessionPreference = undefined;
  } catch { /* Keep the explicit choice in memory when persistence is unavailable. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
}

export function subscribeLanguagePreference(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== LANGUAGE_STORAGE_KEY) return;
    sessionPreference = undefined;
    listener();
  };
  window.addEventListener(LANGUAGE_CHANGE_EVENT, listener);
  window.addEventListener('languagechange', listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, listener);
    window.removeEventListener('languagechange', listener);
    window.removeEventListener('storage', onStorage);
  };
}
