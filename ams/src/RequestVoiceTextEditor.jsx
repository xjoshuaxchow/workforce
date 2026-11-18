import React, { useState } from "react";
import { api } from "./api.js";
import { t, voiceLabel } from "./i18n.js";
import { useI18n } from "./i18n.jsx";
import { Modal, ErrorNotice } from "./ui.jsx";

export function RequestVoiceTextEditor({ request, item, configured, onClose, onSaved }) {
  useI18n();
  const [parts, setParts] = useState(() => [...item.parts]);
  const [saved, setSaved] = useState(item);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const count = parts.join("").length;
  const invalid = count > 1200 || !parts.join("").trim();
  const changed = JSON.stringify(parts) !== JSON.stringify(saved.parts);
  const preview = parts.map((text, i) => text + (saved.tokens[i]?.value ?? "")).join("");
  const close = () => { if (!busy) onClose(); };
  const save = async regenerate => {
    setBusy(true); setError(null);
    try {
      const result = await api(`/requests/${request.id}/voice-text`, { method: "PATCH", body: {
        language: item.language, purpose: item.purpose, expectedHash: saved.hash,
        expectedTextRevision: saved.textRevision, parts,
      } });
      setSaved(result);
      try { await onSaved(result, regenerate); }
      catch { setError(Error(t("editor.saveStale"))); }
    } catch (error) { setError(error); }
    finally { setBusy(false); }
  };
  return <Modal title={t("editor.title", { label: voiceLabel("purpose", item.purpose, item.label) })} onClose={close}>
    <p>{t("editor.intro")}</p>
    <div className="speech-fragments request-voice-fragments">
      {parts.map((text, index) => <React.Fragment key={index}>
        <label className="field speech-fragment">
          <span>{t("speech.fixedLine", { index: index + 1 })}</span>
          <textarea aria-label={t("speech.fixedLine", { index: index + 1 })} rows={2} maxLength={400} disabled={busy} value={text}
            onChange={event => { const value = event.target.value; setParts(old => old.map((part, i) => i === index ? value : part)); }} />
        </label>
        {saved.tokens[index] && <div className="speech-token">
          <small>{t("editor.autoFilled", { label: saved.tokens[index].key === "staff_name" ? t("speech.genericAddress") : voiceLabel("token", saved.tokens[index].key, saved.tokens[index].label) })}</small><strong>{saved.tokens[index].value || t("editor.noExtra")}</strong>
        </div>}
      </React.Fragment>)}
    </div>
    <section className="speech-preview request-voice-preview" aria-label={t("editor.previewLabel")}>
      <h3>{t("editor.previewTitle")}</h3><p className="speech-preview-text">{preview}</p>
      <p className={invalid ? "notice error" : "muted"}>{t("editor.fixedCount", { count })}</p>
    </section>
    <ErrorNotice error={error} />
    <div className="actions">
      <button type="button" disabled={busy || invalid || !changed} onClick={() => save(true)}>{busy ? t("common.processing") : t("editor.save")}</button>

      <button className="quiet" type="button" disabled={busy} onClick={close}>{t("common.cancel")}</button>
    </div>
  </Modal>;
}
