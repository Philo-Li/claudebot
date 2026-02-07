/**
 * i18n.cjs — Bilingual support module (CJS for cross-module compatibility).
 *
 * API:
 *   t(key, params)     — Get translated string, supports {param} interpolation
 *   setLanguage(lang)  — Switch language ('zh' or 'en')
 *   getLanguage()      — Get current language code
 */

const path = require('path');
const fs = require('fs');

const localesDir = path.join(__dirname, 'locales');

const locales = {
  zh: JSON.parse(fs.readFileSync(path.join(localesDir, 'zh.json'), 'utf-8')),
  en: JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf-8')),
};

let currentLang = 'zh';

function t(key, params) {
  const str = (locales[currentLang] && locales[currentLang][key]) || locales.en[key] || key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
}

function setLanguage(lang) {
  if (locales[lang]) {
    currentLang = lang;
  }
}

function getLanguage() {
  return currentLang;
}

module.exports = { t, setLanguage, getLanguage };
