import React, { useState } from "react";
import { api } from "./api.js";
import { Field, ErrorNotice, Modal } from "./ui.jsx";
import { RequestVoiceTextEditor } from "./RequestVoiceTextEditor.jsx";

const languages = { en: "英語", yue: "粵語", zh: "普通話" };
export function LocalVoiceSettings({ draft, setDraft, status }) {
  return <section className="panel settings-panel">
    <h2>本機完整 MP3</h2>
    <p>粵語使用 VITS Cantonese，英語使用 Piper。每份工作的完整音檔生成一次後保存，所有電話重用。</p>
    <p className={status?.installed ? "notice" : "notice error"}>{status?.installed ? "本機語音已安裝，可生成粵語及英語。" : "本機語音尚未安裝，請管理員在後端安裝模型。"}</p>
    <Field label="本機語速" value={String(draft.localSpeech.speed)} options={[["0.7","0.7 倍"],["0.8","0.8 倍"],["0.9","0.9 倍（稍慢）"],["1","1 倍（正常）"],["1.1","1.1 倍"],["1.2","1.2 倍"],["1.3","1.3 倍"]]}
      onChange={speed => setDraft(old => ({ ...old, localSpeech: { speed: Number(speed) } }))} />
    <p className="muted">毋須語音服務 Key。先儲存設定，再到調度草稿生成及試聽 MP3。修改語速或講稿後，新工作需生成相應音檔。</p>
    <p className="muted">粵語講稿中的英文詞組會用 Piper 朗讀，再保存為同一個 MP3，兩種語言的聲線會不同。英文地點讀法可在工作地點填寫；英文通知的補充說明需使用英文。</p>
  </section>;
}
export function AzureVoiceSettings({ draft, setDraft, savedConfig, choices }) {
  const config = draft.voiceSynthesis;
  const change = (key, value) => setDraft(old => ({ ...old, voiceSynthesis: { ...old.voiceSynthesis, [key]: value } }));
  return <section className="panel settings-panel">
    <h2>Azure 完整 MP3</h2>
    <p>每份工作按員工語言生成完整音檔，邀請、確認及取消各自保存一次，所有電話重用。通用回覆提示可跨工作共用。</p>
    <p className="muted">先用私人 Azure Speech F0 資源測試，之後可替換公司的 Key 和 Region；已生成的 MP3 可繼續使用。</p>
    <div className="form-grid">
      <Field label="Azure Region" value={config.region} onChange={v => change("region", v)} />
      <Field label="Azure Speech Key" type="password" value={config.key ?? ""} onChange={v => change("key", v)} />
    </div>
    <p className="muted">Region 填資源顯示的代碼，例如 eastasia。Key {savedConfig?.keyConfigured ? "已設定，留空保留" : "尚未設定"}，儲存後不回傳原值。</p>
    <div className="form-grid">
      {Object.entries(languages).map(([language, label]) => <Field key={language} label={`${label}聲線`} value={config.voices[language]}
        options={(choices?.[language] ?? [config.voices[language]]).map(voice => [voice, voice])}
        onChange={voice => change("voices", { ...config.voices, [language]: voice })} />)}
    </div>
    <p className="muted">先儲存設定，再到調度草稿按「生成缺少 MP3」。生成使用 Azure 額度，試聽及播放已存音檔不會再次合成。此處儲存不會發電話或生成音檔。</p>
    <a href="https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-text-to-speech" target="_blank" rel="noreferrer">Azure 帳戶及 Speech 資源設定說明</a>
  </section>;
}
const statuses = { missing: "尚未生成", ready: "已保存，可重用", submitting: "生成中", unknown: "結果未確定", failed: "生成失敗", archived: "音檔已封存", blocked: "需補英文資料" };
function LanguageAudio({ request, plan, configured, reload, local }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [notice, setNotice] = useState(""), [retry, setRetry] = useState(null), [editing, setEditing] = useState(null);
  const label = languages[plan.language] ?? plan.language;
  const pending = plan.required.filter(item => ["missing", "failed"].includes(item.state));
  const generate = async (items, confirmedRetry = false) => {
    setBusy(true); setError(null); setNotice("");
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setNotice(`生成中 ${i + 1}／${items.length}：${item.label}`);
        const result = await api(`/requests/${request.id}/voice-synthesis`, { method: "POST", body: {
          language: item.language, purpose: item.purpose, expectedHash: item.hash,
          ...(plan.previewOnly ? { previewOnly: true } : {}),
          ...(confirmedRetry ? { retryGeneration: item.generation } : {}),
        } });
        await reload();
        if (result.state !== "ready") throw Error("這份音檔正在生成，稍後按「重新檢查語音」查看結果。");
      }
      setNotice("音檔已保存，之後電話會重用。");
    } catch (e) { setNotice(""); setError(e); await reload().catch(() => {}); }
    finally { setBusy(false); setRetry(null); }
  };
  const restore = async item => {
    setBusy(true); setError(null); setNotice("");
    try {
      await api(`/requests/${request.id}/voice-text`, { method: "PATCH", body: {
        language: item.language, purpose: item.purpose, expectedHash: item.hash, expectedTextRevision: item.textRevision, parts: null,
      } });
      await reload(); setNotice("已恢復預設講稿，原有音檔如仍適用會直接重用。");
    } catch (error) { setError(error); }
    finally { setBusy(false); }
  };
  return <section className="clip-language">
    <h3>{label}</h3>
    {plan.previewOnly && <p className="notice">僅供{label}試聽，電話仍按員工設定選擇語言。</p>}
    {!plan.required.length && <p className="notice error">{local ? "本機語音只支援粵語及英語，請檢查候選員工語言。" : "不支援此員工語言，請修改員工語言後重新檢查。"}</p>}
    {plan.required.length > 0 && (plan.missing.length ? <p className="muted">尚有 {plan.missing.length} 份音檔未齊備。{plan.previewOnly ? "此語言僅供試聽，不影響發送。" : "生成完成後才可發佈。"}</p> : <p className="notice">此語言音檔已齊備。</p>)}
    {request.status === "draft" && pending.length > 0 && <button type="button" disabled={!configured || busy} onClick={() => generate(pending)}>生成缺少 MP3（{label}）</button>}
    <ErrorNotice error={error} />{notice && <p role="status">{notice}</p>}
    <div className="azure-audio-list">
      {plan.required.map(item => <article className="azure-audio-item" key={item.hash}>
        <div className="actions"><h4>{item.label}</h4><span className="muted">{statuses[item.state] ?? item.state}{item.shared ? " · 共用提示" : ""}</span></div>
        {item.customized && <p className="muted">只套用於本工作</p>}
        <p className="speech-preview-text">{item.script}</p>
        {item.issues?.map(issue=><p className="notice error" key={issue}>{issue}</p>)}
        {item.playback_path && <audio key={item.asset_id} controls preload="none" src={item.playback_path} aria-label={`${label}${item.label}完整音檔試聽`} />}
        {request.status === "draft" && item.parts && <div className="actions">
          <button className="quiet" type="button" disabled={busy || item.state === "submitting"} onClick={() => { setError(null); setEditing(item); }}>修改這段講稿</button>
          {item.customized && <button className="quiet" type="button" disabled={busy || item.state === "submitting"} onClick={() => restore(item)}>恢復預設講稿</button>}
        </div>}
        {request.status === "draft" && ["missing", "failed"].includes(item.state) && <button className="quiet" type="button" disabled={busy || !configured} onClick={() => generate([item])}>生成此 MP3</button>}
        {request.status === "draft" && ["unknown", "archived"].includes(item.state) && <>
          <p className="notice error">{item.state === "unknown" ? (local ? "上次本機生成未完成，可重新生成。" : "未能確定 Azure 是否已完成並計費，系統不會自動重試。") : "原音檔已封存。"}</p>
          <button className="quiet" type="button" disabled={busy || !configured} onClick={() => local ? generate([item], true) : setRetry(item)}>{local ? "重新生成此 MP3" : "重新生成此 MP3…"}</button>
        </>}
      </article>)}
    </div>
    {editing && <RequestVoiceTextEditor request={request} item={editing} configured={configured} onClose={() => setEditing(null)} onSaved={async (result, regenerate) => {
      await reload(); setEditing(null); setError(null);
      if (regenerate) await generate([result]);
      else setNotice("這段講稿已儲存，請生成此 MP3 後試聽。其他音檔保持不變。");
    }} />}
    {retry && <Modal title="重新生成 MP3" onClose={() => { if (!busy) setRetry(null); }}>
      <p>重新生成「{retry.label}」會再次呼叫 Azure，可能再次使用額度或收費。已保存的其他音檔會繼續重用。</p>
      <button type="button" disabled={busy} onClick={() => generate([retry], true)}>確認重新生成，可能再次收費</button>
    </Modal>}
  </section>;
}
export function GeneratedRequestAudio({ request, preview, reload, audition = "", onAudition }) {
  const local = preview.mode === "local-mp3";
  const visible = audition ? preview.languages.filter(plan=>plan.language===audition) : preview.languages;
  const pending = preview.languages.filter(plan=>!plan.previewOnly&&plan.missing.length).map(plan=>languages[plan.language]??plan.language);
  return <>
    <p>{local ? "本機完整 MP3 模式。" : "Azure 完整 MP3 模式。"}每份工作、每語言及每用途保存一份完整音檔，電話直接重用。使用通用稱呼，接受按 1、拒絕按 2、重聽按 9。</p>
    <p className="muted">{local ? "語音由本機生成及保存，這裡不會撥電話。" : "生成會使用 Azure 額度或產生合成費，這裡不會撥電話。"}請先核對地點、兩邊日期時間及補充說明，再生成和試聽。</p>
    {!preview.configured && <p className="notice">{local ? "請先由管理員在後端安裝本機語音模型。" : "請先在通訊設定填入 Azure Key 和 Region。"}</p>}
    {local && request.status === "draft" && <>
      <Field label="試聽語言" value={audition} onChange={onAudition} options={[["","按員工語言"],["yue","粵語試聽"],["en","英語試聽"]]} />
      <p className="muted">切換試聽不會修改員工語言，也不會撥電話。{pending.length>0 ? `發送前仍需備妥：${pending.join("、")}音檔。` : "員工所需語言的音檔已齊備。"}</p>
    </>}
    <button className="quiet" type="button" onClick={() => reload().catch(() => {})}>重新檢查語音</button>
    {preview.languages.length === 0 && <p className="muted">加入合資格候選員工後會顯示需要的語言。</p>}
    {visible.map(plan => <LanguageAudio key={plan.language} request={request} plan={plan} configured={preview.configured} reload={reload} local={local} />)}
  </>;
}
