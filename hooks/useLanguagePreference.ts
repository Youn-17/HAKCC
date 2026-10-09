import { useEffect, useSyncExternalStore } from 'react';
import { readPublicLanguage, saveLanguagePreference, subscribeLanguagePreference } from '../utils/languagePreference';

/** All pages share one preference; automatic detection never overwrites a manual choice. */
export function useLanguagePreference() {
  const language = useSyncExternalStore(subscribeLanguagePreference, readPublicLanguage, () => 'zh-CN' as const);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return [language, saveLanguagePreference] as const;
}
