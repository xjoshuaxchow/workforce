import React, { useState } from "react";
import { api } from "./api.js";
import { hasMessage, t, voiceLabel } from "./i18n.js";
import { useI18n } from "./i18n.jsx";
import { Field, ErrorNotice } from "./ui.jsx";
import { RequestVoiceTextEditor } from "./RequestVoiceTextEditor.jsx";

const languageName = (code) => (hasMessage(`language.${code}`) ? t(`language.${code}`) : code);
const voiceState = (state) => (hasMessage(`voice.state.${state}`) ? t(`voice.state.${state}`) : state);
export function LocalVoiceSettings({ draft, setDraft, status }) {
  useI18n();
  return <section className="panel settings-panel">
    <h2>{t("voice.localTitle")}</h2>
    <p>{t("voice.localIntro")}</p>
    <p className={status?.installed ? "notice" : "notice error"}>{status?.installed ? t("voice.installed") : t("voice.missingEngine")}</p>
    <Field label={t("voice.speed")} value={String(draft.localSpeech.speed)} options={[["0.7", t("voice.speed.0_7")], ["0.8", t("voice.speed.0_8")], ["0.85", t("voice.speed.0_85")], ["0.9", t("voice.speed.0_9")], ["1", t("voice.speed.1")], ["1.1", t("voice.speed.1_1")], ["1.2", t("voice.speed.1_2")], ["1.3", t("voice.speed.1_3")]]}
      onChange={speed => setDraft(old => ({ ...old, localSpeech: { speed: Number(speed) } }))} />
    <p className="muted">{t("voice.autoHint")}</p>
    <p className="muted">{t("voice.mixedHint")}</p>
  </section>;
}
function LanguageAudio({ request, plan, configured, reload, local, preparing }) {
  useI18n();
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [notice, setNotice] = useState(""), [editing, setEditing] = useState(null);
  const label = languageName(plan.language);
  const pending = plan.required.filter(item => ["missing", "failed"].includes(item.state));
  const generate = async (items, confirmedRetry = false) => {
    setBusy(true); setError(null); setNotice("");
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setNotice(t("voice.generating", { current: i + 1, total: items.length, label: voiceLabel("purpose", item.purpose, item.label) }));
        const result = await api(`/requests/${request.id}/voice-synthesis`, { method: "POST", body: {
          language: item.language, purpose: item.purpose, expectedHash: item.hash,
          ...(plan.previewOnly ? { previewOnly: true } : {}),
          ...(confirmedRetry ? { retryGeneration: item.generation } : {}),
        } });
        await reload();
        if (result.state !== "ready") throw Error(t("voice.stillGenerating"));
      }
      setNotice(t("voice.savedReuse"));
    } catch (e) { setNotice(""); setError(e); await reload().catch(() => {}); }
    finally { setBusy(false); }
  };
  const restore = async item => {
    setBusy(true); setError(null); setNotice("");
    try {
      await api(`/requests/${request.id}/voice-text`, { method: "PATCH", body: {
        language: item.language, purpose: item.purpose, expectedHash: item.hash, expectedTextRevision: item.textRevision, parts: null,
      } });
      await reload(); setNotice(t("voice.restored"));
    } catch (error) { setError(error); }
    finally { setBusy(false); }
  };
  return <section className="clip-language">
    <h3>{label}</h3>
    {plan.previewOnly && <p className="notice">{t("voice.previewOnly", { label })}</p>}
    {!plan.required.length && <p className="notice error">{local ? t("voice.unsupportedLocal") : t("voice.unsupported")}</p>}
    {plan.required.length > 0 && (plan.missing.length ? <p className="muted">{t("voice.missingCount", { count: plan.missing.length })}{plan.previewOnly ? t("voice.previewOnlyReady") : t("voice.autoReady")}</p> : <p className="notice">{t("voice.ready")}</p>)}
    {request.status === "draft" && pending.length > 0 && <button type="button" disabled={!configured || busy || preparing} onClick={() => generate(pending)}>{t("voice.prepareMissing", { label })}</button>}
    <ErrorNotice error={error} />{notice && <p role="status">{notice}</p>}
    <div className="generated-audio-list">
      {plan.required.map(item => <article className="generated-audio-item" key={item.hash}>
        <div className="actions"><h4>{voiceLabel("purpose", item.purpose, item.label)}</h4><span className="muted">{voiceState(item.state)}{item.shared ? t("voice.sharedScript") : ""}</span></div>
        {item.customized && <p className="muted">{t("voice.customized")}</p>}
        <p className="speech-preview-text">{item.script}</p>
        {item.issues?.map(issue=><p className="notice error" key={issue}>{issue}</p>)}
        {item.playback_path && <audio key={item.asset_id} controls preload="none" src={item.playback_path} aria-label={t("voice.playback", { language: label, label: voiceLabel("purpose", item.purpose, item.label) })} />}
        {request.status === "draft" && item.parts && <div className="actions">
          <button className="quiet" type="button" disabled={busy || item.state === "submitting"} onClick={() => { setError(null); setEditing(item); }}>{t("voice.editScript")}</button>
          {item.customized && <button className="quiet" type="button" disabled={busy || item.state === "submitting"} onClick={() => restore(item)}>{t("voice.restoreScript")}</button>}
        </div>}
        {request.status === "draft" && ["missing", "failed"].includes(item.state) && <button className="quiet" type="button" disabled={busy || preparing || !configured} onClick={() => generate([item])}>{t("voice.generateOne")}</button>}
        {request.status === "draft" && ["unknown", "archived"].includes(item.state) && <>
          <p className="notice error">{item.state === "unknown" ? t("voice.incomplete") : t("voice.archived")}</p>
          <button className="quiet" type="button" disabled={busy || preparing || !configured} onClick={() => generate([item], true)}>{t("voice.regenerateOne")}</button>
        </>}
      </article>)}
    </div>
    {editing && <RequestVoiceTextEditor request={request} item={editing} configured={configured} onClose={() => setEditing(null)} onSaved={async () => {
      await reload(); setEditing(null); setError(null);
      setNotice(t("voice.scriptSaved"));
    }} />}

  </section>;
}
export function GeneratedRequestAudio({ request, preview, reload, audition = "", onAudition, preparing }) {
  useI18n();
  const local = preview.mode === "local-mp3";
  const visible = audition ? preview.languages.filter(plan=>plan.language===audition) : preview.languages;
  const pending = preview.languages.filter(plan=>!plan.previewOnly&&plan.missing.length).map(plan=>languageName(plan.language));
  return <>
    <p>{t("voice.inviteIntro")}</p>
    <p className="muted">{t("voice.optionalHint")}</p>
    {!preview.configured && <p className="notice">{t("voice.installFirst")}</p>}
    {local && request.status === "draft" && <>
      <Field label={t("voice.audition")} value={audition} onChange={onAudition} options={[["", t("language.byStaff")], ["yue", t("language.auditionYue")], ["en", t("language.auditionEn")]]} />
      <p className="muted">{t("voice.auditionHint")}{pending.length>0 ? t("voice.pendingLanguages", { languages: pending.join("、") }) : t("voice.staffReady")}</p>
    </>}
    <button className="quiet" type="button" onClick={() => reload().catch(() => {})}>{t("voice.recheck")}</button>
    {preview.languages.length === 0 && <p className="muted">{t("voice.needCandidates")}</p>}
    {visible.map(plan => <LanguageAudio key={plan.language} request={request} plan={plan} configured={preview.configured} reload={reload} local={local} preparing={preparing} />)}
  </>;
}
