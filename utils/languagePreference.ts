import type { Language } from '../types';
import type { Lang3 } from '../components/LangSwitcher';

const LANGUAGE_STORAGE_KEY = 'hakcc-language';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStoredLanguage(): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readAppLanguage(fallback: Language = 'en'): Language {
  const stored = readStoredLanguage();
  if (stored === 'zh' || stored === 'zh-CN' || stored === 'zh-TW') return 'zh';
  if (stored === 'en') return 'en';
  return fallback;
}

export function readPublicLanguage(fallback: Lang3 = 'en'): Lang3 {
  const stored = readStoredLanguage();
  if (stored === 'zh' || stored === 'zh-CN') return 'zh-CN';
  if (stored === 'zh-TW') return 'zh-TW';
  if (stored === 'en') return 'en';
  return fallback;
}

export function saveLanguagePreference(lang: Language | Lang3) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* Ignore storage failures; language still updates in memory. */
  }
}
