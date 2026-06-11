import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import el from './locales/el.json';
import en from './locales/en.json';

/**
 * #8 — i18n framework foundation.
 *
 * Greek (`el`) is the default AND fallback language — the app is Greek-first. English
 * (`en`) is scaffolded for future localisation. Components opt in with `useTranslation()`
 * and `t('namespace.key')`; hardcoded Greek UI strings are migrated to keys incrementally
 * (start with the `common` namespace below). To add a language: drop a `locales/<lng>.json`
 * and register it in `resources`. To switch at runtime: `i18n.changeLanguage('en')`.
 *
 * This module self-initialises on import (see main.jsx). Until a string is migrated it
 * keeps rendering its hardcoded literal, so adoption can be gradual with zero regressions.
 */
i18n.use(initReactI18next).init({
  resources: {
    el: { translation: el },
    en: { translation: en },
  },
  lng: 'el',
  fallbackLng: 'el',
  interpolation: { escapeValue: false }, // React already escapes
  react: { useSuspense: false },
});

export default i18n;
