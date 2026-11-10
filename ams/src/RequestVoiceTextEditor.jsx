import React, { useState } from "react";
import { api } from "./api.js";
import { Modal, ErrorNotice } from "./ui.jsx";

export function RequestVoiceTextEditor({ request, item, configured, onClose, onSaved }) {
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
      catch { setError(Error("講稿已儲存，但頁面未能更新。可重新檢查語音，或繼續修改後再儲存。")); }
    } catch (error) { setError(error); }
    finally { setBusy(false); }
  };
  return <Modal title={`修改講稿：${item.label}`} onClose={close}>
    <p>只修改本工作這段語音，其他音檔會保留。地點、日期時間及按鍵由系統填入。</p>
    <div className="speech-fragments request-voice-fragments">
      {parts.map((text, index) => <React.Fragment key={index}>
        <label className="field speech-fragment">
          <span>固定字句 {index + 1}</span>
          <textarea aria-label={`固定字句 ${index + 1}`} rows={2} maxLength={400} disabled={busy} value={text}
            onChange={event => { const value = event.target.value; setParts(old => old.map((part, i) => i === index ? value : part)); }} />
        </label>
        {saved.tokens[index] && <div className="speech-token">
          <small>{saved.tokens[index].label} · 自動填入</small><strong>{saved.tokens[index].value || "（沒有補充說明）"}</strong>
        </div>}
      </React.Fragment>)}
    </div>
    <section className="speech-preview request-voice-preview" aria-label="修改後講稿預覽">
      <h3>修改後講稿預覽</h3><p className="speech-preview-text">{preview}</p>
      <p className={invalid ? "notice error" : "muted"}>固定字句 {count}／1200 字，每段上限400字，不能全為空白。</p>
    </section>
    <ErrorNotice error={error} />
    <div className="actions">
      <button type="button" disabled={busy || invalid || !changed} onClick={() => save(true)}>{busy ? "處理中…" : "儲存講稿"}</button>

      <button className="quiet" type="button" disabled={busy} onClick={close}>取消</button>
    </div>
  </Modal>;
}
