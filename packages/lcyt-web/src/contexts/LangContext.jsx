import { createContext, useContext, useState, useCallback } from 'react';
import { getStoredLang, storeLang, getMessages, translate, LOCALE_CODES } from '../lib/i18n';

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(getStoredLang);
  const messages = getMessages(lang);

  const setLang = useCallback((code) => {
    setLangState(code);
    storeLang(code);
  }, []);

  const nextLang = useCallback(() => {
    const idx = LOCALE_CODES.indexOf(lang);
    const next = LOCALE_CODES[(idx + 1) % LOCALE_CODES.length];
    setLang(next);
  }, [lang, setLang]);

  const t = useCallback((key) => translate(messages, key), [messages]);

  return (
    <LangContext.Provider value={{ lang, setLang, nextLang, t, LOCALE_CODES }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LangProvider');
  return ctx;
}
