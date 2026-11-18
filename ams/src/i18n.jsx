import React, { createContext, useContext, useEffect, useState } from "react";
import { getLocale, setLocale, subscribeLocale, t } from "./i18n.js";

const LocaleContext = createContext(getLocale());

export function I18nProvider({ children }) {
  const [locale, set] = useState(getLocale);
  useEffect(() => subscribeLocale(() => set(getLocale())), []);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const locale = useContext(LocaleContext);
  return { t, locale, setLocale };
}

export function LocaleSwitch() {
  const { locale, setLocale: changeLocale, t: translate } = useI18n();
  return (
    <label className="locale-switch">
      <span>{translate("common.interfaceLanguage")}</span>
      <select value={locale} onChange={(event) => changeLocale(event.target.value)}>
        <option value="zh-Hant">繁體中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
