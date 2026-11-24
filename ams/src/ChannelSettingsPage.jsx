import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { t, voiceLabel } from "./i18n.js";
import { useI18n } from "./i18n.jsx";
import { Field, ErrorNotice, Modal } from "./ui.jsx";
import { ClipLibrary, RequestVoicePreview } from "./VoiceClips.jsx";
import { LocalVoiceSettings } from "./GeneratedVoice.jsx";
export const languageCodes = ["en", "yue"];
export function languageOptions() {
  return languageCodes.map((code) => [code, t(`language.${code}`)]);
}
const purposeKeys = [
  "shift_offer_v1",
  "shift_confirmed_v1",
  "shift_unavailable_v1",
  "shift_cancelled_v1",
  "roster_published_v1",
  "roster_changed_v1",
];
const purposeOptions = () => purposeKeys.map((key) => [key, t(`purpose.${key}`)]);
const variableKeys = [
  "staff_name",
  "site_name",
  "site_address",
  "date",
  "start_time",
  "end_time",
  "message",
  "shifts",
  "old_date",
  "old_start_time",
  "old_end_time",
  "change",
];
const variableOptions = () => variableKeys.map((key) => [key, t(`variable.${key}`)]);
const editable = (config) => {
  const copy = structuredClone(config);
  delete copy.voice.authTokenConfigured;
  delete copy.whatsapp.keyConfigured;
  copy.voice.authToken = "";
  copy.whatsapp.key = "";
  return copy;
};
export const RequestVoiceSpeech = RequestVoicePreview;
const remoteTemplateButtons = (template) =>
  template?.components?.find((component) => component.type === "BUTTONS")?.buttons ?? [];
function TemplateDialog({ language, purpose, template, onClose, onDone }) {
  useI18n();
  const offer = purpose === "shift_offer_v1",
    flow = offer && (!template || remoteTemplateButtons(template)[0]?.type === "FLOW"),
    bodyComponent = template?.components?.find((x) => x.type === "BODY");
  const [name, setName] = useState(
    template?.name ?? (flow ? `workforce_shift_offer_flow_${language}_v1` : ""),
  ),
    [locale, setLocale] = useState(
      template?.language ??
        (language === "yue" ? "zh_HK" : flow ? "en_US" : "en"),
    ),
    [body, setBody] = useState(
      bodyComponent?.text ??
        (language === "en"
          ? offer
            ? "Hello {{1}}, a new shift invitation is available for you at {{2}} on {{3}}. The shift starts at {{4}} and ends at {{5}}. Please review the shift details and tap the button below to accept or decline this invitation."
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
            ...(flow ? { flow: true } : {}),
          },
        },
      );
      onDone(locale);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={template ? t("template.editRemote") : t("template.createRemote")}
      onClose={onClose}
    >
      <p className="muted">
        {t(flow ? "template.flowCreateHint" : "template.metaHint")}
      </p>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field
            label={t("template.newName")}
            value={name}
            onChange={setName}
            required
            disabled={Boolean(template)}
          />
          <Field
            label={t("template.localeCode")}
            value={locale}
            onChange={setLocale}
            required
            disabled={Boolean(template)}
          />
          <Field
            label={t("template.category")}
            value={category}
            onChange={setCategory}
            options={[
              ["UTILITY", t("template.utility")],
              ["MARKETING", t("template.marketing")],
            ]}
          />
        </div>
        <Field label={t("template.body")}>
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </Field>
        <p className="muted">
          {t("template.variableHintBefore")}
          {"{{1}}"}、{"{{2}}"}
          {t("template.variableHintAfter")}
        </p>
        {numbers.map((n) => (
          <Field
            key={n}
            label={t("template.example", { n })}
            value={examples[n] ?? ""}
            onChange={(value) => setExamples((old) => ({ ...old, [n]: value }))}
            required
          />
        ))}
        <button disabled={busy}>{busy ? t("template.submitting") : t("template.submit")}</button>
      </form>
    </Modal>
  );
}
function TemplateSettings({ draft, setDraft }) {
  useI18n();
  const [language, setLanguage] = useState("en"),
    [purpose, setPurpose] = useState("shift_offer_v1"),
    [remote, setRemote] = useState([]),
    [cursor, setCursor] = useState(null),
    [remoteLocale, setRemoteLocale] = useState(null),
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
  const fetchTemplates = async (more = false, locale = value.language) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api(
        `/settings/whatsapp/templates?language=${encodeURIComponent(locale)}${more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      );
      setRemote((old) => (more ? [...old, ...r.data] : r.data));
      setCursor(r.nextCursor);
      setRemoteLocale(locale);
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
    const buttons = remoteTemplateButtons(row);
    if (!offer) return buttons.length === 0;
    return (buttons.length === 1 && buttons[0].type === "FLOW") ||
      (buttons.length === 2 && buttons.every((button) => button.type === "QUICK_REPLY"));
  };
  const choose = (row) => {
    const text = row.components.find((c) => c.type === "BODY")?.text ?? "",
      count = Math.max(
        0,
        ...[...text.matchAll(/\{\{(\d+)\}\}/g)].map((x) => Number(x[1])),
      );
    const fields = variableKeys, flow = remoteTemplateButtons(row)[0]?.type === "FLOW";
    update({
      name: row.name,
      language: row.language,
      body: Array.from(
        { length: count },
        (_, i) => value.body[i] ?? fields[i] ?? "message",
      ),
      ...(offer ? {
        flow: flow ? true : undefined,
        buttons: flow ? undefined : { accept: 0, decline: 1 },
      } : {}),
    });
  };
  return (
    <section className="panel settings-panel">
      <h2>{t("template.whatsappTitle")}</h2>
      <div className="form-grid">
        <Field
          label={t("template.contentLanguage")}
          value={language}
          onChange={(v) => {
            setLanguage(v);
            setRemote([]);
            setCursor(null);
          }}
          options={languageOptions()}
        />
        <Field
          label={t("template.purpose")}
          value={purpose}
          onChange={setPurpose}
          options={purposeOptions()}
        />
        <Field
          label={t("template.name")}
          value={value.name}
          onChange={(name) => update({ name })}
        />
        <Field
          label={t("template.metaLanguage")}
          value={value.language}
          onChange={(language) => update({ language })}
        />
      </div>
      <p className="muted">{t("template.mappingHint")}</p>
      <h3>{t("template.variableOrder")}</h3>
      {value.body.map((field, index) => (
        <div className="actions" key={index}>
          <Field
            label={t("template.position", { index: index + 1 })}
            value={field}
            onChange={(next) =>
              update({
                body: value.body.map((old, i) => (i === index ? next : old)),
              })
            }
            options={variableOptions()}
          />
          <button
            className="quiet"
            type="button"
            onClick={() =>
              update({ body: value.body.filter((_, i) => i !== index) })
            }
          >
            {t("template.removePosition", { index: index + 1 })}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="quiet"
        onClick={() => update({ body: [...value.body, "message"] })}
      >
        {t("template.addVariable")}
      </button>
      {offer && value.flow && <p className="muted">{t("template.flowMapped")}</p>}
      {offer && !value.flow && (
        <div className="form-grid">
          <Field
            label={t("template.acceptIndex")}
            type="number"
            value={value.buttons?.accept ?? 0}
            onChange={(v) =>
              update({ buttons: { ...value.buttons, accept: Number(v) } })
            }
          />
          <Field
            label={t("template.declineIndex")}
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
          {t("template.loadRemote")}
        </button>
        <button type="button" className="quiet" onClick={() => setDialog({})}>
          {t("template.create")}
        </button>
      </div>
      <ErrorNotice error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("template.columnTemplate")}</th>
              <th>{t("template.columnLanguage")}</th>
              <th>{t("template.columnReview")}</th>
              <th>{t("common.actions")}</th>
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
                  {remoteTemplateButtons(row)[0]?.type === "FLOW" && (
                    <small>{t("template.flowType")}</small>
                  )}
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
                      {t("template.use")}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!compatible(row) || (
                        remoteTemplateButtons(row)[0]?.type === "FLOW" &&
                        !remoteTemplateButtons(row)[0].flow_id
                      )}
                      onClick={() => setDialog(row)}
                    >
                      {t("template.modify")}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setDeleting(row)}
                    >
                      {t("template.delete")}
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
          onClick={() => fetchTemplates(true, remoteLocale)}
        >
          {t("template.loadMore")}
        </button>
      )}
      {dialog && (
        <TemplateDialog
          language={language}
          purpose={purpose}
          template={dialog.id ? dialog : null}
          onClose={() => setDialog(null)}
          onDone={(locale) => {
            setDialog(null);
            fetchTemplates(false, locale);
          }}
        />
      )}
      {deleting && (
        <Modal title={t("template.deleteTitle")} onClose={() => setDeleting(null)}>
          <p>{t("template.deleteBody", { name: deleting.name })}</p>
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
            {t("template.confirmDelete")}
          </button>
        </Modal>
      )}
    </section>
  );
}
function VoiceSettings({ draft, setDraft, layout, shared = false, local = false }) {
  useI18n();
  const [language, setLanguage] = useState("yue"),
    [purpose, setPurpose] = useState("offer");
  const spokenLanguages = languageOptions().filter(([code]) => !local || code !== "zh");
  const parts = draft.voiceTexts?.[language]?.[purpose],
    definition = layout?.[purpose] && { ...layout[purpose], tokens: layout[purpose].tokens.map(token => ({ ...token, label: shared && token.key === "staff_name" ? t("speech.genericAddress") : voiceLabel("token", token.key, token.label) })) },
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
      <h2>{shared ? t("speech.sharedTitle") : t("speech.sayTitle")}</h2>
      <p>{shared ? t("speech.sharedIntro") : t("speech.sayIntro")}</p>
      <p className="muted">{t("speech.editHint")}</p>
      {definition && parts ? (
        <>
          <div className="form-grid speech-selectors">
            <Field label={t("speech.language")} value={language} onChange={setLanguage} options={spokenLanguages} />
            <Field label={t("speech.purpose")} value={purpose} onChange={setPurpose}
              options={Object.entries(layout).map(([key, value]) => [key, voiceLabel("purpose", key, value.label)])} />
          </div>
          <div className="speech-workspace">
            <div className="speech-fragments">
              {parts.map((text, index) => (
                <React.Fragment key={`${language}-${purpose}-${index}`}>
                  <label className="field speech-fragment">
                    <span>{t("speech.fixedLine", { index: index + 1 })}</span>
                    <textarea aria-label={t("speech.fixedLine", { index: index + 1 })} rows={2} maxLength={400}
                      value={text} onChange={(e) => changePart(index, e.target.value)} />
                  </label>
                  {definition.tokens[index] && (
                    <div className="speech-token">
                      <small>{definition.tokens[index].key.endsWith("_key") ? t("speech.fixedKey") : t("speech.systemFill")}</small>
                      <strong>{definition.tokens[index].label}</strong>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
            <section className="speech-preview" aria-label={t("speech.previewLabel")}>
              <h3>{t("speech.previewTitle")}</h3>
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
              <p className={count > 1200 ? "notice error" : "muted"}>{t("speech.fixedCount", { count })}</p>
              <p className="muted">{shared ? t("speech.sharedPreviewHint") : t("speech.sayPreviewHint")}</p>
              <p className="muted">{t("speech.saveHint")}</p>
            </section>
          </div>
        </>
      ) : <p className="muted">{t("speech.reloadHint")}</p>}
      {!shared && <><h3>{t("speech.voiceTitle")}</h3>
      <table>
        <thead><tr><th>{t("speech.employeeLanguage")}</th><th>{t("speech.phoneLanguage")}</th><th>{t("speech.voiceName")}</th></tr></thead>
        <tbody>
          <tr><td>{t("language.yue")}</td><td>{t("speech.yuePhone")}</td><td>Google.yue-HK-Standard-A</td></tr>
          <tr><td>{t("language.en")}</td><td>{t("speech.enPhone")}</td><td>Google.en-GB-Standard-A</td></tr>
        </tbody>
      </table></>}
      <p className="muted">{t("speech.systemDataHint")}</p>
      <p className="muted">{t("speech.testHint")}</p>
    </section>
  );
}
export function ChannelSettingsPage({ notify }) {
  useI18n();
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
      notify(t("settings.saved"));
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
          <p className="eyebrow">{t("settings.eyebrow")}</p>
          <h1>{t("settings.title")}</h1>
          <p className="muted">{t("settings.intro")}</p>
        </div>
        {draft && (
          <button disabled={busy} onClick={attemptSave}>
            {busy ? t("common.saving") : t("settings.save")}
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {!draft ? (
        <p>{t("settings.loading")}</p>
      ) : (
        <>
          <div className="toolbar">
            {[
              ["connection", t("settings.tabConnection")],
              ["whatsapp", t("settings.tabWhatsapp")],
              ["voice", t("settings.tabVoice")],
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
                    label={t("settings.twilioMode")}
                    value={draft.voice.mode}
                    onChange={change("voice", "mode")}
                    options={[
                      ["mock", t("settings.mock")],
                      ["twilio-pstn", t("settings.realVoice")],
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
                    label={t("settings.fromNumber")}
                    value={draft.voice.fromNumber}
                    onChange={change("voice", "fromNumber")}
                  />
                  <Field
                    label={t("settings.publicBase")}
                    value={draft.voice.publicBaseUrl}
                    onChange={change("voice", "publicBaseUrl")}
                  />
                </div>
                <p className="muted">
                  {t("settings.tokenHint", {
                    state: current.config.voice.authTokenConfigured
                      ? t("settings.secretSet")
                      : t("settings.secretMissing"),
                  })}
                </p>
              </section>
              <section className="panel settings-panel">
                <h2>WhatsApp microservice</h2>
                <div className="form-grid">
                  <Field
                    label={t("settings.whatsappMode")}
                    value={draft.whatsapp.mode}
                    onChange={change("whatsapp", "mode")}
                    options={[
                      ["mock", t("settings.mock")],
                      ["service", t("settings.realService")],
                    ]}
                  />
                  <Field
                    label={t("settings.serviceUrl")}
                    value={draft.whatsapp.url}
                    onChange={change("whatsapp", "url")}
                  />
                  <Field
                    label={t("settings.apiKey")}
                    type="password"
                    value={draft.whatsapp.key}
                    onChange={change("whatsapp", "key")}
                  />
                </div>
                <p className="muted">
                  {t("settings.keyHint", {
                    state: current.config.whatsapp.keyConfigured
                      ? t("settings.secretSet")
                      : t("settings.secretMissing"),
                  })}
                </p>
              </section>
            </>
          )}
          {tab === "whatsapp" && (
            <TemplateSettings draft={draft} setDraft={setDraft} />
          )}{" "}
          {tab === "voice" && (
            <>
              <section className="panel settings-panel"><Field label={t("settings.contentMode")} value={draft.voiceClips?.mode ?? "say"} onChange={mode=>setDraft(old=>({...old,voiceClips:{...old.voiceClips,mode}}))} options={[["local-mp3", t("settings.modeLocal")], ["say", t("settings.modeSay")], ["clips", t("settings.modeClips")]]}/><p className="muted">{t("settings.modeHint")}</p></section>
              {draft.voiceClips?.mode === "clips" ? <ClipLibrary draft={draft} setDraft={setDraft} savedVersion={current.id}/>
                : <>
                {draft.voiceClips?.mode === "local-mp3" && <LocalVoiceSettings draft={draft} setDraft={setDraft} status={current.localSpeechStatus}/>}
                <VoiceSettings key={draft.voiceClips?.mode} draft={draft} setDraft={setDraft} layout={current.voiceTextLayout} shared={draft.voiceClips?.mode === "local-mp3"} local={draft.voiceClips?.mode === "local-mp3"}/></>}
            </>
          )}
        </>
      )}
      {confirm && (
        <Modal title={t("settings.enableTitle")} onClose={() => setConfirm(false)}>
          <p>{t("settings.enableBody")}</p>
          <button disabled={busy} onClick={save}>
            {t("settings.confirmEnable")}
          </button>
        </Modal>
      )}
    </>
  );
}
