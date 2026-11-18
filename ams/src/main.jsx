import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { applyDocumentLocale } from "./i18n.js";
import { I18nProvider } from "./i18n.jsx";
import "./style.css";
applyDocumentLocale();
createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
