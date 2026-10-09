// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppLanguage, readPublicLanguage, saveLanguagePreference, subscribeLanguagePreference } from '../utils/languagePreference';

let unsubscribe: () => void;
beforeEach(() => {
  localStorage.clear();
  unsubscribe = subscribeLanguagePreference(() => {});
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN']);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
});
afterEach(() => { unsubscribe(); vi.restoreAllMocks(); });

describe('language preference', () => {
  it.each([
    [['zh-CN'], 'zh-CN'], [['en-GB', 'zh-CN'], 'en'],
    [['fr-FR', 'zh-TW', 'en'], 'zh-TW'], [['zh-HK'], 'zh-TW'],
    [['zh-MO'], 'zh-TW'], [['zh-Hant'], 'zh-TW'],
    [['zh-Hans-HK'], 'zh-CN'], [['zh-SG'], 'zh-CN'], [['ja-JP'], 'zh-CN'],
  ])('matches browser preferences %j before first render', (languages, expected) => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
    expect(readPublicLanguage()).toBe(expected);
    expect(localStorage.getItem('hakcc-language')).toBeNull();
  });
  it('uses navigator.language when the preference list is empty', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue([]);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    expect(readAppLanguage()).toBe('en');
  });
  it('keeps a saved manual choice ahead of browser preferences', () => {
    localStorage.setItem('hakcc-language', 'en');
    expect(readAppLanguage()).toBe('en');
  });
  it('accepts legacy Chinese preferences and ignores invalid storage', () => {
    localStorage.setItem('hakcc-language', 'zh');
    expect(readPublicLanguage()).toBe('zh-CN');
    localStorage.setItem('hakcc-language', 'invalid');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    expect(readPublicLanguage()).toBe('en');
  });
  it('maps Traditional Chinese to app Chinese without overwriting the preference', () => {
    saveLanguagePreference('zh-TW');
    expect(readAppLanguage()).toBe('zh');
    expect(readPublicLanguage()).toBe('zh-TW');
    expect(localStorage.getItem('hakcc-language')).toBe('zh-TW');
  });
  it('notifies mounted pages on manual changes and changes in other tabs', () => {
    const listener = vi.fn(); const off = subscribeLanguagePreference(listener);
    saveLanguagePreference('en');
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.setItem('hakcc-language', 'zh-TW');
    window.dispatchEvent(new StorageEvent('storage', { key: 'hakcc-language' }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readPublicLanguage()).toBe('zh-TW'); off();
  });
  it('works when storage access is blocked and keeps manual choices for the session', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    expect(readPublicLanguage()).toBe('zh-CN');
    saveLanguagePreference('en');
    expect(readAppLanguage()).toBe('en');
  });
});
