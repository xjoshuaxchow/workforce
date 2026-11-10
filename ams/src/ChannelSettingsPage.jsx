import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Field, ErrorNotice, Modal } from "./ui.jsx";
import { ClipLibrary, RequestVoicePreview } from "./VoiceClips.jsx";
import { LocalVoiceSettings } from "./GeneratedVoice.jsx";
export const languages = [
  ["en", "英語"],
  ["yue", "粵語"],
];
const purposes = [
  ["shift_offer_v1", "工作邀請"],
  ["shift_confirmed_v1", "接單確認"],
  ["shift_unavailable_v1", "已額滿"],
  ["shift_cancelled_v1", "取消通知"],
  ["roster_published_v1", "班表發布"],
  ["roster_changed_v1", "班表變更"],
];
const variableLabels = {
  staff_name: "員工姓名",
  site_name: "地點名稱",
  site_address: "地點地址",
  date: "日期",
  start_time: "開始時間",
  end_time: "結束時間",
  message: "額外訊息",
  shifts: "班次清單",
  old_date: "原日期",
  old_start_time: "原開始時間",
  old_end_time: "原結束時間",
  change: "變更說明",
};
const editable = (config) => {
  const copy = structuredClone(config);
  delete copy.voice.authTokenConfigured;
  delete copy.whatsapp.keyConfigured;
  copy.voice.authToken = "";
  copy.whatsapp.key = "";
  return copy;
};
export const RequestVoiceSpeech = RequestVoicePreview;
function TemplateDialog({ language, purpose, template, onClose, onDone }) {
  const offer = purpose === "shift_offer_v1",
    bodyComponent = template?.components?.find((x) => x.type === "BODY");
  const [name, setName] = useState(template?.name ?? ""),
    [locale, setLocale] = useState(
      template?.language ??
        (language === "yue" ? "zh_HK" : language === "zh" ? "zh_CN" : "en"),
    ),
    [body, setBody] = useState(
      bodyComponent?.text ??
        (language === "en"
          ? offer
            ? "Hello {{1}}, a new shift invitation is available for you at {{2}} on {{3}}. The shift starts at {{4}} and ends at {{5}}. Please review the shift details and use the buttons below to accept or decline this invitation."
            : "Hello {{1}}, this is an update about your work schedule at {{2}} on {{3}}. The scheduled start time is {{4}} and the scheduled end time is {{5}}. Please review these details and contact your supervisor if you have any questions."
          : offer
            ? "你好 {{1}}，現有一個工作更次邀請。工作地點為 {{2}}，工作日期為 {{3}}，開始時間為 {{4}}，結束時間為 {{5}}。請仔細核對以上工作安排，再按下方按鈕接受或拒絕邀請。如有疑問，請聯絡你的主管。"
            : "你好 {{1}}，這是一則工作安排更新通知。工作地點為 {{2}}，工作日期為 {{3}}，開始時間為 {{4}}，結束時間為 {{5}}。請仔細核對以上工作資料，如有任何疑問，請聯絡你的主管。"),
    ),
    [examples, setExamples] = useState({
      1: "Anna",
      2: "North Depot",
      3: "10 Nov 2099",
      4: "07:00",
      5: "15:00",
    }),
    [category, setCategory] = useState(template?.category ?? "UTILITY"),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const numbers = [
    ...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((x) => Number(x[1]))),
  ].sort((a, b) => a - b);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        "/settings/whatsapp/templates" + (template ? "/" + template.id : ""),
        {
          method: template ? "PATCH" : "POST",
          body: {
            name,
            language: locale,
            category,
            body,
            examples: numbers.map((n) => examples[n] ?? ""),
            offer,
          },
        },
      );
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={template ? "修改微服務模板" : "建立微服務模板"}
      onClose={onClose}
    >
      <p className="muted">
        送交 Meta 後需等待核准，儲存並不代表可立即發送。這裡管理純文字 BODY
        及邀請的兩個回覆按鈕。
      </p>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="新模板名稱"
            value={name}
            onChange={setName}
            required
            disabled={Boolean(template)}
          />
          <Field
            label="模板語言代碼"
            value={locale}
            onChange={setLocale}
            required
            disabled={Boolean(template)}
          />
          <Field
            label="模板分類"
            value={category}
            onChange={setCategory}
            options={[
              ["UTILITY", "服務通知"],
              ["MARKETING", "推廣"],
            ]}
          />
        </div>
        <Field label="範本文字">
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </Field>
        <p className="muted">
          變數使用 {"{{1}}"}、{"{{2}}"} 等位置標記。請填寫供 Meta 審核的範例值。
        </p>
        {numbers.map((n) => (
          <Field
            key={n}
            label={`變數 ${n} 範例`}
            value={examples[n] ?? ""}
            onChange={(value) => setExamples((old) => ({ ...old, [n]: value }))}
            required
          />
        ))}
        <button disabled={busy}>{busy ? "送交中…" : "送交模板"}</button>
      </form>
    </Modal>
  );
}
function TemplateSettings({ draft, setDraft }) {
  const [language, setLanguage] = useState("en"),
    [purpose, setPurpose] = useState("shift_offer_v1"),
    [remote, setRemote] = useState([]),
    [cursor, setCursor] = useState(null),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState(null),
    [deleting, setDeleting] = useState(null);
  const value = draft.templates[language][purpose],
    offer = purpose === "shift_offer_v1";
  const update = (patch) =>
    setDraft((old) => ({
      ...old,
      templates: {
        ...old.templates,
        [language]: {
          ...old.templates[language],
          [purpose]: { ...old.templates[language][purpose], ...patch },
        },
      },
    }));
  const fetchTemplates = async (more = false) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api(
        `/settings/whatsapp/templates?language=${encodeURIComponent(value.language)}${more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      );
      setRemote((old) => (more ? [...old, ...r.data] : r.data));
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const compatible = (row) => {
    const components = row.components ?? [];
    if (
      row.parameter_format === "NAMED" ||
      components.some((c) => !["BODY", "BUTTONS"].includes(c.type))
    )
      return false;
    const buttons = components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
    return offer
      ? buttons.length === 2 && buttons.every((b) => b.type === "QUICK_REPLY")
      : buttons.length === 0;
  };
  const choose = (row) => {
    const text = row.components.find((c) => c.type === "BODY")?.text ?? "",
      count = Math.max(
        0,
        ...[...text.matchAll(/\{\{(\d+)\}\}/g)].map((x) => Number(x[1])),
      );
    const fields = Object.keys(variableLabels);
    update({
      name: row.name,
      language: row.language,
      body: Array.from(
        { length: count },
        (_, i) => value.body[i] ?? fields[i] ?? "message",
      ),
      ...(offer ? { buttons: { accept: 0, decline: 1 } } : {}),
    });
  };
  return (
    <section className="panel settings-panel">
      <h2>WhatsApp 粵語及英文模板</h2>
      <div className="form-grid">
        <Field
          label="內容語言"
          value={language}
          onChange={(v) => {
            setLanguage(v);
            setRemote([]);
            setCursor(null);
          }}
          options={languages}
        />
        <Field
          label="通知用途"
          value={purpose}
          onChange={setPurpose}
          options={purposes}
        />
        <Field
          label="模板名稱"
          value={value.name}
          onChange={(name) => update({ name })}
        />
        <Field
          label="Meta 語言代碼"
          value={value.language}
          onChange={(language) => update({ language })}
        />
      </div>
      <p className="muted">
        每種語言與通知用途各自對應 Meta
        模板。可先保存對應資料；真實發送前必須使用已核准且位置參數相符的模板。
      </p>
      <h3>變數順序</h3>
      {value.body.map((field, index) => (
        <div className="actions" key={index}>
          <Field
            label={`位置 ${index + 1}`}
            value={field}
            onChange={(next) =>
              update({
                body: value.body.map((old, i) => (i === index ? next : old)),
              })
            }
            options={Object.entries(variableLabels)}
          />
          <button
            className="quiet"
            type="button"
            onClick={() =>
              update({ body: value.body.filter((_, i) => i !== index) })
            }
          >
            移除位置 {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="quiet"
        onClick={() => update({ body: [...value.body, "message"] })}
      >
        新增變數位置
      </button>
      {offer && (
        <div className="form-grid">
          <Field
            label="接受按鈕 index"
            type="number"
            value={value.buttons?.accept ?? 0}
            onChange={(v) =>
              update({ buttons: { ...value.buttons, accept: Number(v) } })
            }
          />
          <Field
            label="拒絕按鈕 index"
            type="number"
            value={value.buttons?.decline ?? 1}
            onChange={(v) =>
              update({ buttons: { ...value.buttons, decline: Number(v) } })
            }
          />
        </div>
      )}
      <hr />
      <div className="actions">
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => fetchTemplates()}
        >
          讀取微服務模板
        </button>
        <button type="button" className="quiet" onClick={() => setDialog({})}>
          建立模板
        </button>
      </div>
      <ErrorNotice error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>模板</th>
              <th>語言</th>
              <th>審核狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {remote.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.name}
                  <small>
                    {row.components?.find((c) => c.type === "BODY")?.text}
                  </small>
                </td>
                <td>{row.language}</td>
                <td>{row.status}</td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={row.status !== "APPROVED" || !compatible(row)}
                      onClick={() => choose(row)}
                    >
                      使用此模板
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!compatible(row)}
                      onClick={() => setDialog(row)}
                    >
                      修改
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setDeleting(row)}
                    >
                      刪除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => fetchTemplates(true)}
        >
          載入更多模板
        </button>
      )}
      {dialog && (
        <TemplateDialog
          language={language}
          purpose={purpose}
          template={dialog.id ? dialog : null}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            fetchTemplates();
          }}
        />
      )}
      {deleting && (
        <Modal title="刪除微服務模板" onClose={() => setDeleting(null)}>
          <p>
            將從微服務／Meta 刪除 {deleting.name}
            。請先確認沒有新的通知需要使用它。
          </p>
          <button
            onClick={async () => {
              try {
                await api("/settings/whatsapp/templates/" + deleting.id, {
                  method: "DELETE",
                });
                setDeleting(null);
                fetchTemplates();
              } catch (e) {
                setError(e);
                setDeleting(null);
              }
            }}
          >
            確認刪除
          </button>
        </Modal>
      )}
    </section>
  );
}
function VoiceSettings({ draft, setDraft, layout, shared = false, local = false }) {
  const [language, setLanguage] = useState("yue"),
    [purpose, setPurpose] = useState("offer");
  const parts = draft.voiceTexts?.[language]?.[purpose],
    definition = layout?.[purpose] && { ...layout[purpose], tokens: layout[purpose].tokens.map(token => shared && token.key === "staff_name" ? { ...token, label: "通用稱呼" } : token) },
    count = parts?.join("").length ?? 0;
  const changePart = (index, value) => setDraft((old) => ({
    ...old,
    voiceTexts: {
      ...old.voiceTexts,
      [language]: {
        ...old.voiceTexts[language],
        [purpose]: old.voiceTexts[language][purpose].map((text, i) => i === index ? value : text),
      },
    },
  }));
  return (
    <section className="panel settings-panel">
      <h2>{shared ? "AI MP3 固定講稿" : "Twilio Say 粵語及英語"}</h2>
      <p>{shared ? "完整音檔使用通用稱呼，同一工作及語言的員工共用，不加入個別姓名。" : "電話按員工語言自動朗讀邀請、確認及取消通知，毋須上傳錄音。"}</p>
      <p className="muted">可修改固定用詞或改用同音字修正讀音。系統資料和按鍵已鎖定，不能在這裡修改。</p>
      {definition && parts ? (
        <>
          <div className="form-grid speech-selectors">
            <Field label="講稿語言" value={language} onChange={setLanguage} options={local ? languages.filter(([code])=>code!=="zh") : languages} />
            <Field label="講稿用途" value={purpose} onChange={setPurpose}
              options={Object.entries(layout).map(([key, value]) => [key, value.label])} />
          </div>
          <div className="speech-workspace">
            <div className="speech-fragments">
              {parts.map((text, index) => (
                <React.Fragment key={`${language}-${purpose}-${index}`}>
                  <label className="field speech-fragment">
                    <span>固定字句 {index + 1}</span>
                    <textarea aria-label={`固定字句 ${index + 1}`} rows={2} maxLength={400}
                      value={text} onChange={(e) => changePart(index, e.target.value)} />
                  </label>
                  {definition.tokens[index] && (
                    <div className="speech-token">
                      <small>{definition.tokens[index].key.endsWith("_key") ? "固定按鍵" : "系統填入"}</small>
                      <strong>{definition.tokens[index].label}</strong>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
            <section className="speech-preview" aria-label="講稿預覽">
              <h3>講稿預覽</h3>
              <p className="speech-preview-text">
                {parts.map((text, index) => (
                  <React.Fragment key={index}>
                    {text}
                    {definition.tokens[index] && (
                      <span className="speech-placeholder">
                        {definition.tokens[index].key.endsWith("_key")
                          ? { accept_key: "1", decline_key: "2", repeat_key: "9" }[definition.tokens[index].key]
                          : `〔${definition.tokens[index].label}〕`}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </p>
              <p className={count > 1200 ? "notice error" : "muted"}>固定字句 {count}／1200 字，每段上限 400 字。</p>
              <p className="muted">{shared ? "這是文字預覽，儲存後調度草稿會自動準備 MP3，亦可選擇試聽。" : "這是文字預覽。實際讀音仍以 Twilio 電話為準。"}</p>
              <p className="muted">完成後按頁頂「儲存設定」。新邀請使用新講稿；已發出的邀請及其跟進通知保留原講稿。</p>
            </section>
          </div>
        </>
      ) : <p className="muted">重新載入通訊設定後即可編輯講稿。</p>}
      {!shared && <><h3>電話聲線</h3>
      <table>
        <thead><tr><th>員工語言</th><th>電話語言</th><th>聲線</th></tr></thead>
        <tbody>
          <tr><td>粵語</td><td>香港粵語</td><td>Google.yue-HK-Standard-A</td></tr>
          <tr><td>英語</td><td>英國英語</td><td>Google.en-GB-Standard-A</td></tr>
        </tbody>
      </table></>}
      <p className="muted">地點、地址及班次時間由系統加入，使用香港時間。跨午夜會讀出結束日期。接受請按 1，拒絕請按 2，重聽請按 9。</p>
      <p className="muted">請在員工資料選擇語言，並於真機測試核對地址、數字及日期的讀音。</p>
    </section>
  );
}
export function ChannelSettingsPage({ notify }) {
  const [current, setCurrent] = useState(null),
    [draft, setDraft] = useState(null),
    [tab, setTab] = useState("connection"),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    api("/settings/channels")
      .then((r) => {
        setCurrent(r);
        setDraft(editable(r.config));
      })
      .catch(setError);
  }, []);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const config = structuredClone(draft);
      if (!config.voice.authToken) delete config.voice.authToken;
      if (!config.whatsapp.key) delete config.whatsapp.key;
      const r = await api("/settings/channels", {
        method: "PATCH",
        body: { expectedVersion: current.id, config },
      });
      setCurrent(r);
      setDraft(editable(r.config));
      setConfirm(false);
      await api("/messaging/status");
      notify("通訊設定已儲存");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const attemptSave = () => {
    if (
      (current.config.voice.mode === "mock" && draft.voice.mode !== "mock") ||
      (current.config.whatsapp.mode === "mock" &&
        draft.whatsapp.mode !== "mock")
    )
      setConfirm(true);
    else save();
  };
  const change = (section, key) => (value) =>
    setDraft((old) => ({
      ...old,
      [section]: { ...old[section], [key]: value },
    }));
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHANNELS</p>
          <h1>通訊設定</h1>
          <p className="muted">
            管理連線、粵語及英文模板與電話語音。已排程邀請保留原設定，後續新邀請使用新設定。
          </p>
        </div>
        {draft && (
          <button disabled={busy} onClick={attemptSave}>
            {busy ? "儲存中…" : "儲存設定"}
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {!draft ? (
        <p>載入設定中…</p>
      ) : (
        <>
          <div className="toolbar">
            {[
              ["connection", "連線設定"],
              ["whatsapp", "WhatsApp 模板"],
              ["voice", "電話語音"],
            ].map(([key, label]) => (
              <button
                type="button"
                className={tab === key ? "" : "quiet"}
                key={key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "connection" && (
            <>
              <section className="panel settings-panel">
                <h2>Twilio PSTN</h2>
                <div className="form-grid">
                  <Field
                    label="Twilio 模式"
                    value={draft.voice.mode}
                    onChange={change("voice", "mode")}
                    options={[
                      ["mock", "本機模擬"],
                      ["twilio-pstn", "真實電話"],
                    ]}
                  />
                  <Field
                    label="Account SID"
                    value={draft.voice.accountSid}
                    onChange={change("voice", "accountSid")}
                  />
                  <Field
                    label="Auth Token"
                    type="password"
                    value={draft.voice.authToken}
                    onChange={change("voice", "authToken")}
                  />
                  <Field
                    label="主叫號碼"
                    value={draft.voice.fromNumber}
                    onChange={change("voice", "fromNumber")}
                  />
                  <Field
                    label="公開回調網址前綴"
                    value={draft.voice.publicBaseUrl}
                    onChange={change("voice", "publicBaseUrl")}
                  />
                </div>
                <p className="muted">
                  Token{" "}
                  {current.config.voice.authTokenConfigured
                    ? "已設定，留空保留"
                    : "尚未設定"}
                  。填公開 HTTPS 網域，例如 https://example.ngrok-free.app，不加 /api；DTMF、通話狀態及錄音路徑由系統自動加上。內容方式在「電話語音」選擇。
                </p>
              </section>
              <section className="panel settings-panel">
                <h2>WhatsApp microservice</h2>
                <div className="form-grid">
                  <Field
                    label="WhatsApp 模式"
                    value={draft.whatsapp.mode}
                    onChange={change("whatsapp", "mode")}
                    options={[
                      ["mock", "本機模擬"],
                      ["service", "真實微服務"],
                    ]}
                  />
                  <Field
                    label="WhatsApp 服務網址"
                    value={draft.whatsapp.url}
                    onChange={change("whatsapp", "url")}
                  />
                  <Field
                    label="WhatsApp API key"
                    type="password"
                    value={draft.whatsapp.key}
                    onChange={change("whatsapp", "key")}
                  />
                </div>
                <p className="muted">
                  API key{" "}
                  {current.config.whatsapp.keyConfigured
                    ? "已設定，留空保留"
                    : "尚未設定"}
                  。填 microservice origin，不加
                  /v1。密鑰儲存後不會回傳到瀏覽器。可先啟用真實微服務並準備模板；實際發送前仍會檢查使用的模板是否已核准。
                </p>
              </section>
            </>
          )}
          {tab === "whatsapp" && (
            <TemplateSettings draft={draft} setDraft={setDraft} />
          )}{" "}
          {tab === "voice" && (
            <>
              <section className="panel settings-panel"><Field label="電話內容方式" value={draft.voiceClips?.mode ?? "say"} onChange={mode=>setDraft(old=>({...old,voiceClips:{...old.voiceClips,mode}}))} options={[["local-mp3","本機生成完整 MP3（粵語／英語）"],["say","Twilio Say 語音合成"],["clips","自備 MP3／WAV 片段"]]}/><p className="muted">儲存後只影響新發出的工作，原有工作及跟進通知保留原設定。</p></section>
              {draft.voiceClips?.mode === "clips" ? <ClipLibrary draft={draft} setDraft={setDraft} savedVersion={current.id}/>
                : <>
                {draft.voiceClips?.mode === "local-mp3" && <LocalVoiceSettings draft={draft} setDraft={setDraft} status={current.localSpeechStatus}/>}
                <VoiceSettings key={draft.voiceClips?.mode} draft={draft} setDraft={setDraft} layout={current.voiceTextLayout} shared={draft.voiceClips?.mode === "local-mp3"} local={draft.voiceClips?.mode === "local-mp3"}/></>}
            </>
          )}
        </>
      )}
      {confirm && (
        <Modal title="啟用真實渠道" onClose={() => setConfirm(false)}>
          <p>
            儲存後，新建立的邀請可能發出真實電話或
            WhatsApp。請確認接收名單、模板及員工語言；原有 mock
            工作不會自動改為真實發送。
          </p>
          <button disabled={busy} onClick={save}>
            確認啟用並儲存
          </button>
        </Modal>
      )}
    </>
  );
}
