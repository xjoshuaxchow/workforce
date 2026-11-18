import { RequestVoiceSpeech } from "./ChannelSettingsPage.jsx";
import React, { useEffect, useState } from "react";
import { api, loadAllPages } from "./api.js";
import { formatDate, hasMessage, t } from "./i18n.js";
import { useI18n } from "./i18n.jsx";
import {
  Field,
  Modal,
  ErrorNotice,
  Pager,
  useList,
  useAllList,
  PagedSelect,
} from "./ui.jsx";
import { localToUtc, utcToLocal, dayAfter, today, HONG_KONG_TIMEZONE } from "./time.js";
const statusText = (code) => {
  if (!code) return "—";
  const key = `dispatch.status.${code}`;
  return hasMessage(key) ? t(key) : code;
};
const fmt = (value, zone) => utcToLocal(value, zone).replace("T", " ");
export function RequestForm({ sites, preset, copyFrom, onClose, onDone }) {
  useI18n();
  const zone = HONG_KONG_TIMEZONE;
  const [value, setValue] = useState(() => {
    const now = Date.now();
    const copyTimes = copyFrom && Date.parse(copyFrom.start_at) > now;
    const copySite = copyFrom && sites.some((site) => site.id === copyFrom.site_id && site.status === "active");
    return {
      site_id: copyFrom
        ? (copySite ? copyFrom.site_id : "")
        : (preset?.site_id ?? sites.find((site) => site.status === "active")?.id ?? ""),
      mode: copyFrom?.mode ?? preset?.mode ?? "broadcast",
      staff_id: copySite && copyFrom.mode === "direct"
        ? copyFrom.candidates[0]?.staff_id ?? ""
        : preset?.staff_id ?? "",
      headcount: copyFrom?.headcount ?? preset?.open_shift_ids?.length ?? 1,
      voice: copyFrom ? copyFrom.channels.includes("voice") : true,
      whatsapp: copyFrom ? copyFrom.channels.includes("whatsapp") : true,
      message: copyFrom?.message ?? "",
      start: copyTimes ? utcToLocal(copyFrom.start_at, zone) : "",
      end: copyTimes ? utcToLocal(copyFrom.end_at, zone) : "",
      deadline: copyTimes && Date.parse(copyFrom.deadline_at) > now
        ? utcToLocal(copyFrom.deadline_at, zone)
        : "",
    };
  }),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (preset?.start_at)
      setValue((x) => ({
        ...x,
        start: utcToLocal(preset.start_at, zone),
        end: utcToLocal(preset.end_at, zone),
      }));
  }, [preset?.start_at, zone]);
  const change = (key) => (v) => setValue((x) => ({ ...x, [key]: v }));
  const {
    data: staff,
    error: staffError,
    loading: staffLoading,
  } = useAllList(value.site_id ? `/sites/${value.site_id}/staff` : null);
  const staffOptions = copyFrom ? staff.items.filter((person) => person.status === "active") : staff.items;
  const selectedStaff = copyFrom && !staffOptions.some((person) => person.id === value.staff_id)
    ? ""
    : value.staff_id;
  const timeError =
    value.start && value.end && value.end <= value.start
      ? {
          message: t("dispatch.endAfterStart"),
          errors: [{ field: "end_at", message: t("dispatch.endAfterStart") }],
        }
      : null;
  const formTime = (field, local) => {
    const original = copyFrom?.[field];
    return original && local === utcToLocal(original, zone) ? original : localToUtc(local, zone);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (timeError) return;
    setBusy(true);
    try {
      const r = await api("/requests", {
        method: "POST",
        body: {
          site_id: value.site_id,
          mode: value.mode,
          staff_id: selectedStaff,
          headcount: Number(value.headcount),
          channels: ["whatsapp", "voice"].filter((c) => value[c]),
          message: value.message,
          start_at: formTime("start_at", value.start),
          end_at: formTime("end_at", value.end),
          ...(value.deadline
            ? { deadline_at: formTime("deadline_at", value.deadline) }
            : {}),
          ...(preset?.open_shift_ids
            ? { open_shift_ids: preset.open_shift_ids }
            : {}),
        },
      });
      onDone(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t(copyFrom ? "dispatch.copyRequest" : "dispatch.createTitle")} onClose={onClose}>
      <p className="muted">{t("dispatch.timeHint")}</p>
      {copyFrom && Date.parse(copyFrom.start_at) <= Date.now() &&
        <p className="muted">{t("dispatch.copyPastShift")}</p>}
      <ErrorNotice error={timeError ?? error ?? staffError} />
      <form onSubmit={submit}>
        <Field
          label={t("dispatch.site")}
          value={value.site_id}
          onChange={(v) =>
            setValue((x) => ({
              ...x,
              site_id: v,
              staff_id: preset?.staff_id ?? "",
            }))
          }
          required={Boolean(copyFrom)}
          options={[
            ...(!value.site_id ? [["", t("dispatch.choose")]] : []),
            ...sites.filter((s) => s.status === "active")
              .filter((s) => value.mode !== "direct" || !preset?.site_ids || preset.site_ids.includes(s.id))
              .map((s) => [s.id, s.name]),
          ]}
        />
        <div className="form-grid">
          <Field
            label={t("dispatch.start")}
            type="datetime-local"
            value={value.start}
            onChange={change("start")}
            required
          />
          <Field
            label={t("dispatch.end")}
            type="datetime-local"
            value={value.end}
            onChange={change("end")}
            required
          />
          <Field
            label={t("dispatch.mode")}
            value={value.mode}
            onChange={change("mode")}
            options={[
              ["broadcast", t("dispatch.broadcast")],
              ["direct", t("dispatch.direct")],
            ]}
          />
          {value.mode === "direct" ? (
            <Field
              key={value.site_id}
              label={t("dispatch.staff")}
              value={selectedStaff}
              onChange={change("staff_id")}
              options={[
                ["", t("dispatch.choose")],
                ...staffOptions.map((s) => [s.id, s.name]),
              ]}
            />
          ) : (
            <Field
              label={t("dispatch.headcount")}
              type="number"
              value={value.headcount}
              onChange={change("headcount")}
              required
            />
          )}
          <Field
            label={t("dispatch.deadline")}
            type="datetime-local"
            value={value.deadline}
            onChange={change("deadline")}
          />
        </div>
        <p className="muted">{t("dispatch.deadlineHint")}</p>
        <div className="actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.whatsapp}
              onChange={(e) => change("whatsapp")(e.target.checked)}
            />
            WhatsApp
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.voice}
              onChange={(e) => change("voice")(e.target.checked)}
            />
            {t("common.voice")}
          </label>
        </div>
        <Field
          label={t("dispatch.message")}
          value={value.message}
          onChange={change("message")}
        />
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            disabled={
              busy ||
              !value.site_id ||
              Boolean(timeError) ||
              Boolean(staffError) ||
              (value.mode === "direct" && (staffLoading || !selectedStaff))
            }
          >
            {busy ? t("dispatch.creating") : t("dispatch.createDraft")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RequestEditor({ request, sites, deadlineOnly, onClose, onDone }) {
  useI18n();
  const draft = request.status === "draft";
  const shiftEditable = draft && !request.open_shift_ids.length;
  const headcountEditable = request.mode === "broadcast" && !request.open_shift_ids.length;
  const zone = HONG_KONG_TIMEZONE;
  const [initial] = useState(() => ({
    site_id: request.site_id,
    start_at: utcToLocal(request.start_at, zone),
    end_at: utcToLocal(request.end_at, zone),
    deadline_at: utcToLocal(request.deadline_at, zone),
    headcount: String(request.headcount),
    message: request.message,
  }));
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const change = (key) => (next) => setValue((current) => ({ ...current, [key]: next }));
  const changeStart = (start_at) => setValue((current) => ({
    ...current,
    start_at,
    deadline_at: current.deadline_at === current.start_at ? start_at : current.deadline_at,
  }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { expected_utime: request.utime };
      const fields = deadlineOnly
        ? ["deadline_at"]
        : ["site_id", "start_at", "end_at", "deadline_at", "headcount", "message"];
      for (const key of fields) {
        if (value[key] === initial[key]) continue;
        body[key] = key.endsWith("_at") ? localToUtc(value[key], zone)
          : key === "headcount" ? Number(value[key]) : value[key];
      }
      if (deadlineOnly && (!body.deadline_at || Date.parse(body.deadline_at) <= Date.parse(request.deadline_at))) {
        setError({ message: t("dispatch.deadlineLater") });
        return;
      }
      await api(`/requests/${request.id}`, { method: "PATCH", body });
      onDone();
    } catch (e) {
      const key = `dispatch.editError.${e.reason}`;
      setError(hasMessage(key) ? { message: t(key) } : e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t(deadlineOnly ? "dispatch.extendDeadline" : "dispatch.editRequest")} onClose={onClose}>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        {!deadlineOnly && (
          <div className="form-grid">
            {shiftEditable && <>
              <Field
                label={t("dispatch.site")}
                value={value.site_id}
                onChange={change("site_id")}
                options={sites.filter((site) => site.status === "active" || site.id === request.site_id)
                  .map((site) => [site.id, site.name])}
              />
              <Field label={t("dispatch.start")} type="datetime-local" value={value.start_at}
                onChange={changeStart} required />
              <Field label={t("dispatch.end")} type="datetime-local" value={value.end_at}
                onChange={change("end_at")} required />
            </>}
            {headcountEditable && (
              <Field label={t("dispatch.headcount")} required>
                <input type="number" min={Math.max(1, request.accepted)} max={50}
                  aria-label={t("dispatch.headcount")} value={value.headcount} onChange={(e) => change("headcount")(e.target.value)} required />
              </Field>
            )}
            {draft && (
              <Field label={t("dispatch.deadline")} type="datetime-local" value={value.deadline_at}
                onChange={change("deadline_at")} required />
            )}
          </div>
        )}
        {deadlineOnly ? <>
          <p className="muted">{t("dispatch.currentDeadline", { time: fmt(request.deadline_at, zone) })}</p>
          <Field label={t("dispatch.newDeadline")} type="datetime-local" value={value.deadline_at}
            onChange={change("deadline_at")} required />
          <p className="muted">{t("dispatch.deadlineLimit", { time: fmt(request.start_at, zone) })}</p>
        </> : <>
          <Field label={t("dispatch.message")}>
            <textarea value={value.message} maxLength={500} rows={3}
              onChange={(e) => change("message")(e.target.value)} />
          </Field>
          {!draft && <p className="muted">{t("dispatch.sentEditHint")}</p>}
          {!draft && headcountEditable && request.accepted > 0 &&
            <p className="muted">{t("dispatch.headcountEditHint", { count: request.accepted })}</p>}
        </>}
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>{t("common.cancel")}</button>
          <button disabled={busy}>{t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function VoiceAttempts({ attempts, zone }) {
  const calls = attempts.filter((attempt) => attempt.channel === "voice" && attempt.purpose === "offer");
  const latest = calls.at(-1);
  return (
    <>
      {statusText(latest?.status)}
      {latest?.response_at && (
        <small>
          <time aria-label={t("dispatch.voiceReply")} dateTime={latest.response_at}>
            {t("dispatch.repliedAt", { time: fmt(latest.response_at, zone) })}
          </time>
        </small>
      )}
      {calls.length > 1 && (
        <details className="voice-history">
          <summary>{t("dispatch.callHistory", { count: calls.length })}</summary>
          <ol>
            {calls.slice().reverse().map((call) => (
              <li key={call.id}>
                <time dateTime={call.ctime}>
                  {formatDate(call.ctime, { dateStyle: "short", timeStyle: "medium", timeZone: zone })}
                </time>
                {" · "}{statusText(call.status)}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
function RequestDetail({ id, onBack, onDraftCreated, sites, notify, messagingMode }) {
  useI18n();
  const [data, setData] = useState(null),
    [error, setError] = useState(null),
    [confirm, setConfirm] = useState(null),
    [editing, setEditing] = useState(null),
    [copyFrom, setCopyFrom] = useState(null),
    [busy, setBusy] = useState(false),
    [voicePreparing, setVoicePreparing] = useState(false),
    [linked, setLinked] = useState([]),
    [toAdd, setToAdd] = useState("");
  const load = () =>
    api(`/requests/${id}`)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch(setError);
  useEffect(() => {
    let active = true;
    const get = () =>
      api(`/requests/${id}`)
        .then((r) => active && setData(r))
        .catch((e) => active && setError(e));
    get();
    const timer = setInterval(get, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  useEffect(() => {
    if (data?.status === "draft")
      loadAllPages(`/sites/${data.site_id}/staff`)
        .then((r) => setLinked(r.items))
        .catch(setError);
  }, [data?.site_id, data?.status]);
  const action = async (path, body = {}, method = "POST") => {
    setBusy(true);
    try {
      await api(path, { method, body });
      await load();
      setToAdd("");
      setConfirm(null);
    } catch (e) {
      if (e.reason === "redial_unavailable") await load();
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <>
        <ErrorNotice error={error} />
        <p className="muted">{t("dispatch.loading")}</p>
      </>
    );
  const site = sites.find((s) => s.id === data.site_id),
    zone = HONG_KONG_TIMEZONE;
  const canEdit = ["draft", "open"].includes(data.status) && new Date(data.deadline_at) > new Date();
  const canExtend = canEdit && data.status === "open" && new Date(data.deadline_at) < new Date(data.start_at);
  const redialCandidate = confirm?.kind === "redial" ? confirm.candidate : null;
  const redialStillAvailable = redialCandidate && data.candidates.some((candidate) =>
    candidate.id === redialCandidate.id &&
    candidate.mobile === redialCandidate.mobile &&
    candidate.redial_attempt_id === redialCandidate.redial_attempt_id,
  );
  const closeRedial = () => {
    setConfirm(null);
    setError(null);
  };
  return (
    <>
      <button className="text-button" onClick={onBack}>
        {t("dispatch.backToList")}
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("dispatch.detailEyebrow")}</p>
          <h1>{t("dispatch.detailTitle")}</h1>
          <p className="muted">
            {site?.name} · {fmt(data.start_at, zone)} {t("common.until")}{" "}
            {fmt(data.end_at, zone)}
          </p>
        </div>
        <div className="actions">
          {data.elevenlabs_pilot && (
            <button disabled={busy} onClick={() => action(`/requests/${id}/send`, { voice_mode: "elevenlabs-pilot" })}>
              {busy ? t("dispatch.pilotDialling") : t("dispatch.pilotCall")}
            </button>
          )}
          {data.status === "draft" && (
            <button className={data.elevenlabs_pilot ? "quiet" : undefined} disabled={busy || voicePreparing} onClick={() => action(`/requests/${id}/send`)}>
              {busy || voicePreparing ? t("dispatch.preparingSend") : t("dispatch.send")}
            </button>
          )}
          {canEdit && (
            <button className="quiet" disabled={busy || voicePreparing}
              onClick={() => setEditing({ request: data, deadlineOnly: false })}>
              {t("dispatch.editRequest")}
            </button>
          )}
          {canExtend && (
            <button className="quiet" disabled={busy}
              onClick={() => setEditing({ request: data, deadlineOnly: true })}>
              {t("dispatch.extendDeadline")}
            </button>
          )}
          <button
            className="quiet"
            disabled={busy || !sites.some((site) => site.status === "active")}
            onClick={() => setCopyFrom(data)}
          >
            {t("dispatch.copyRequest")}
          </button>
          {["draft", "open", "filled"].includes(data.status) && (
            <button className="quiet" onClick={() => setConfirm("cancel")}>
              {t("dispatch.cancelRequest")}
            </button>
          )}
        </div>
      </div>
      <ErrorNotice error={redialCandidate ? null : error} />
      <div className="dispatch-summary">
        <section className="panel metric">
          <p>{t("dispatch.acceptedCount")}</p>
          <h2>
            {data.accepted} / {data.headcount}
          </h2>
        </section>
        <section className="panel metric">
          <p>{t("common.status")}</p>
          <strong className="large-status">{statusText(data.status)}</strong>
        </section>
        <section className="panel metric">
          <p>{t("dispatch.deadlineZone", { zone })}</p>
          <strong>{fmt(data.deadline_at, zone)}</strong>
          {canEdit && data.status === "open" && !canExtend &&
            <small>{t("dispatch.deadlineAtStart")}</small>}
        </section>
      </div>
      {data.message && (
        <section className="panel request-message">
          <h2>{t("dispatch.message")}</h2>
          <p>{data.message}</p>
        </section>
      )}
      <section className="panel">
        <div className="section-title">
          <h2>{t("dispatch.candidates")}</h2>
          <span className="muted">{t("dispatch.refreshHint")}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("common.staff")}</th>
                <th>{t("dispatch.result")}</th>
                <th>WhatsApp</th>
                <th>{t("common.voice")}</th>
                <th>{t("dispatch.replyTime")}</th>
                <th>{t("dispatch.manual")}</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <small>{c.mobile}</small>
                  </td>
                  <td>
                    <span
                      className={`badge ${c.status === "accepted" ? "success" : ""}`}
                    >
                      {statusText(c.status)}
                    </span>
                    {c.assignment?.status === "cancelled" && (
                      <small>{t("dispatch.assignmentCancelled")}</small>
                    )}
                    {c.reason && <small>{c.reason}</small>}
                  </td>
                  {["whatsapp", "voice"].map((channel) => {
                    if (channel === "voice")
                      return <td key={channel}><VoiceAttempts attempts={c.attempts} zone={zone} /></td>;
                    const attempt = c.attempts.find(
                      (a) => a.channel === channel && a.purpose === "offer",
                    );
                    return (
                      <td key={channel}>
                        {statusText(attempt?.status)}
                        {attempt?.response_at && (
                          <small>
                            <time
                              aria-label={t("dispatch.whatsappReply")}
                              dateTime={attempt.response_at}
                            >
                              {t("dispatch.repliedAt", { time: fmt(attempt.response_at, zone) })}
                            </time>
                          </small>
                        )}
                      </td>
                    );
                  })}
                  <td>{c.response_at ? fmt(c.response_at, zone) : "—"}</td>
                  <td>
                    {data.status === "draft" && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          action(
                            `/requests/${id}/candidates/${c.id}`,
                            {},
                            "DELETE",
                          )
                        }
                      >
                        {t("dispatch.removeCandidate")}
                      </button>
                    )}
                    {c.redial_attempt_id && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setConfirm({ candidate: c, kind: "redial" });
                        }}
                      >
                        {t("dispatch.redial")}
                      </button>
                    )}
                    {c.status === "contacting" && data.status === "open" && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({ candidate: c, kind: "confirm" })
                        }
                      >
                        {t("dispatch.confirmAccept")}
                      </button>
                    )}
                    {c.assignment?.status === "confirmed" &&
                      ["open", "filled"].includes(data.status) && (
                        <button
                          className="text-button"
                          onClick={() =>
                            setConfirm({ candidate: c, kind: "remove" })
                          }
                        >
                          {t("dispatch.removeSlot")}
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.candidates.length && (
            <div className="empty">{t("dispatch.noCandidates")}</div>
          )}
        </div>
      </section>
      {data.status === "draft" && (
        <section className="panel candidate-add">
          <PagedSelect
            label={t("dispatch.addCandidateLabel")}
            value={toAdd}
            onChange={setToAdd}
            options={[
              ["", t("dispatch.chooseLinked")],
              ...linked
                .filter(
                  (s) => !data.candidates.some((c) => c.staff_id === s.id),
                )
                .map((s) => [s.id, `${s.name} · ${s.mobile}`]),
            ]}
          />
          <button
            disabled={!toAdd || busy}
            onClick={() =>
              action(`/requests/${id}/candidates`, { staff_id: toAdd })
            }
          >
            {t("dispatch.addCandidate")}
          </button>
        </section>
      )}
      {data.elevenlabs_pilot && <p className="muted">{t("dispatch.pilotHint")}</p>}
      {data.candidates.some(candidate => candidate.attempts.some(attempt => attempt.payload?.voice_mode === "elevenlabs-pilot")) ? (
        <p className="muted">{t("dispatch.pilotSent")}</p>
      ) : (
        <RequestVoiceSpeech request={data} onPreparing={setVoicePreparing} />
      )}
      {data.excluded?.length > 0 && (
        <section className="panel exclusions">
          <h2>{t("dispatch.excluded")}</h2>
          {data.excluded.map((x) => (
            <p key={x.staff_id}>
              {x.name} · {x.reason}
            </p>
          ))}
        </section>
      )}
      {import.meta.env.DEV && messagingMode === "mock" && (
        <details className="panel dev-tools">
          <summary>{t("dispatch.devTools")}</summary>
          <p className="muted">{t("dispatch.devHint")}</p>
          {data.candidates.map((c) => (
            <div className="mock-row" key={c.id}>
              <strong>{c.name}</strong>
              {c.attempts
                .filter((a) => a.purpose === "offer")
                .map((a) => (
                  <div key={a.id} className="actions">
                    <span>{a.channel === "voice" ? t("common.voice") : t("common.whatsapp")}</span>
                    <button
                      className="quiet"
                      onClick={() =>
                        action(`/mock/attempts/${a.id}/events`, {
                          type: "reply",
                          option_id: "ACCEPT",
                        })
                      }
                    >
                      {t("dispatch.mockAccept")}
                    </button>
                    <button
                      className="quiet"
                      onClick={() =>
                        action(`/mock/attempts/${a.id}/events`, {
                          type: "reply",
                          option_id: "DECLINE",
                        })
                      }
                    >
                      {t("dispatch.mockDecline")}
                    </button>
                    {a.channel === "voice" && (
                      <button
                        className="quiet"
                        onClick={() =>
                          action(`/mock/attempts/${a.id}/events`, {
                            type: "no_answer",
                          })
                        }
                      >
                        {t("dispatch.mockNoAnswer")}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </details>
      )}
      {copyFrom && (
        <RequestForm
          sites={sites}
          copyFrom={copyFrom}
          onClose={() => setCopyFrom(null)}
          onDone={onDraftCreated}
        />
      )}
      {editing && (
        <RequestEditor
          request={editing.request}
          deadlineOnly={editing.deadlineOnly}
          sites={sites}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
            notify(t(editing.deadlineOnly ? "dispatch.deadlineExtended" : "dispatch.requestUpdated"));
          }}
        />
      )}
      {redialCandidate && (
        <Modal title={t("dispatch.redial")} onClose={closeRedial}>
          <p>{t("dispatch.redialBody", { name: redialCandidate.name, number: redialCandidate.mobile })}</p>
          <ErrorNotice error={error?.reason === "redial_unavailable" || (!busy && !redialStillAvailable)
            ? { message: t("dispatch.redialUnavailable") }
            : error} />
          <div className="form-actions">
            <button className="quiet" onClick={closeRedial}>{t("common.back")}</button>
            <button
              disabled={busy || !redialStillAvailable}
              onClick={() => action(
                `/requests/${id}/candidates/${redialCandidate.id}/redial`,
                { attempt_id: redialCandidate.redial_attempt_id },
              )}
            >
              {t("dispatch.redial")}
            </button>
          </div>
        </Modal>
      )}
      {confirm && !redialCandidate && (
        <Modal
          title={
            confirm === "send"
              ? t("dispatch.confirmSendTitle")
              : confirm === "cancel"
                ? t("dispatch.cancelRequest")
                : t("dispatch.confirmManual")
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === "send"
              ? t("dispatch.confirmSendBody", {
                  count: data.candidates.length,
                  channels: data.channels.map((c) => (c === "voice" ? t("common.voice") : t("common.whatsapp"))).join(t("dispatch.channelJoin")),
                })
              : confirm === "cancel"
                ? t("dispatch.cancelBody")
                : confirm.kind === "remove"
                  ? t("dispatch.removeBody", { name: confirm.candidate.name })
                  : t("dispatch.acceptBody", { name: confirm.candidate.name })}
          </p>
          <div className="form-actions">
            <button className="quiet" onClick={() => setConfirm(null)}>
              {t("common.back")}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                action(
                  `/requests/${id}/${typeof confirm === "string" ? confirm : `candidates/${confirm.candidate.id}/${confirm.kind}`}`,
                )
              }
            >
              {confirm === "send" ? t("dispatch.confirmSend") : t("common.confirm")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Requests({ notify, preset, onPresetUsed, messagingMode }) {
  useI18n();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [version, setVersion] = useState(0),
    [form, setForm] = useState(Boolean(preset)),
    [selected, setSelected] = useState(null);
  const { data: sites, error: siteError } = useAllList("/sites"),
    { data, error, loading } = useList(
      `/requests?page=${page}&status=${status}`,
      version,
    );
  const done = (r) => {
    setForm(false);
    setSelected(r.id);
    setVersion((x) => x + 1);
    onPresetUsed?.();
    notify(t("dispatch.draftCreated"));
  };
  if (selected)
    return (
      <RequestDetail
        key={selected}
        messagingMode={messagingMode}
        onDraftCreated={done}
        id={selected}
        sites={sites.items}
        notify={notify}
        onBack={() => {
          setSelected(null);
          setVersion((x) => x + 1);
        }}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("dispatch.eyebrow")}</p>
          <h1>{t("dispatch.title")}</h1>
          <p className="muted">{t("dispatch.intro")}</p>
        </div>
        <button
          disabled={!sites.items.some((s) => s.status === "active")}
          onClick={() => setForm(true)}
        >
          {t("dispatch.add")}
        </button>
      </div>
      <ErrorNotice error={error ?? siteError} />
      <section className="panel">
        <div className="toolbar">
          <select
            aria-label={t("dispatch.statusFilter")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("dispatch.allStatuses")}</option>
            {["draft", "open", "filled", "expired", "cancelled"].map((k) => (
              <option key={k} value={k}>
                {statusText(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("dispatch.site")}</th>
                <th>{t("dispatch.columnTime")}</th>
                <th>{t("dispatch.columnHeadcount")}</th>
                <th>{t("common.status")}</th>
                <th>{t("dispatch.columnCreator")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.site_name}</strong>
                  </td>
                  <td>
                    {fmt(
                      r.start_at,
                      HONG_KONG_TIMEZONE,
                    )}
                    <small>
                      {t("common.until")}{" "}
                      {fmt(
                        r.end_at,
                        HONG_KONG_TIMEZONE,
                      )}
                    </small>
                  </td>
                  <td>
                    {r.accepted} / {r.headcount}
                  </td>
                  <td>
                    <span
                      className={`badge ${r.status === "filled" ? "success" : ""}`}
                    >
                      {statusText(r.status)}
                    </span>
                  </td>
                  <td>{r.created_by_name}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setSelected(r.id)}
                    >
                      {t("dispatch.view")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length && (
            <div className="empty">
              {loading ? t("common.loading") : t("dispatch.empty")}
            </div>
          )}
        </div>
        <Pager data={data} page={page} onChange={setPage} />
      </section>
      {form && (
        <RequestForm
          sites={sites.items}
          preset={preset}
          onClose={() => {
            setForm(false);
            onPresetUsed?.();
          }}
          onDone={done}
        />
      )}
    </>
  );
}
function ShiftForm({ site, staff, shift, onDone, onClose }) {
  useI18n();
  const zone = HONG_KONG_TIMEZONE,
    [value, setValue] = useState({
      staff_id: shift?.staff_id ?? "",
      start: shift ? utcToLocal(shift.start_at, zone) : "",
      end: shift ? utcToLocal(shift.end_at, zone) : "",
      notes: shift?.notes ?? "",
    }),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const change = (key) => (v) => setValue((x) => ({ ...x, [key]: v }));
  const save = async (acknowledge = false) => {
    setBusy(true);
    try {
      await api(shift ? `/shifts/${shift.id}` : "/shifts", {
        method: shift ? "PATCH" : "POST",
        body: {
          site_id: site.id,
          staff_id: value.staff_id || null,
          start_at: localToUtc(value.start, zone),
          end_at: localToUtc(value.end, zone),
          notes: value.notes,
          acknowledge_warnings: acknowledge,
        },
      });
      onDone(t("roster.saved"));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={shift ? t("roster.editTitle") : t("roster.createTitle")} onClose={onClose}>
      <p className="muted">
        {site.name} · {zone}
      </p>
      <ErrorNotice error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {shift?.request_id && (
          <p className="notice success">
            {t("roster.managedNotice")}
          </p>
        )}
        <Field
          disabled={Boolean(shift?.request_id)}
          label={t("roster.assignee")}
          value={value.staff_id}
          onChange={change("staff_id")}
          options={[
            ["", t("roster.unassigned")],
            ...staff.map((s) => [s.id, s.name]),
          ]}
        />
        <div className="form-grid">
          <Field
            disabled={Boolean(shift?.request_id)}
            label={t("dispatch.start")}
            type="datetime-local"
            required
            value={value.start}
            onChange={change("start")}
          />
          <Field
            disabled={Boolean(shift?.request_id)}
            label={t("dispatch.end")}
            type="datetime-local"
            required
            value={value.end}
            onChange={change("end")}
          />
        </div>
        <Field label={t("roster.notes")} value={value.notes} onChange={change("notes")} />
        {error?.warnings && (
          <div className="notice error">
            {error.warnings.join("、")}
            <button type="button" className="quiet" onClick={() => save(true)}>
              {t("roster.confirmWarning")}
            </button>
          </div>
        )}
        <div className="form-actions">
          {shift &&
            !shift.request_id &&
            !["completed", "cancelled"].includes(shift.status) && (
              <button
                type="button"
                className="quiet"
                onClick={async () => {
                  if (!window.confirm(t("roster.cancelConfirm"))) return;
                  try {
                    await api(`/shifts/${shift.id}/cancel`, {
                      method: "POST",
                      body: {},
                    });
                    onDone(t("roster.cancelled"));
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {t("roster.cancelShift")}
              </button>
            )}
          <button type="button" className="quiet" onClick={onClose}>
            {t("common.back")}
          </button>
          <button disabled={busy}>{t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
export function Roster({ notify, onFindStaff }) {
  useI18n();
  const { data: sites, error: siteError } = useAllList("/sites"),
    { data: people, error: peopleError } = useAllList("/staff");
  const [siteId, setSiteId] = useState(""),
    [week, setWeek] = useState(today(HONG_KONG_TIMEZONE)),
    [data, setData] = useState(null),
    [error, setError] = useState(null),
    [version, setVersion] = useState(0),
    [form, setForm] = useState(null),
    [selected, setSelected] = useState(new Set()),
    [publishing, setPublishing] = useState(false),
    [publishResult, setPublishResult] = useState(null);
  useEffect(() => {
    if (!siteId && sites.items.length) setSiteId(sites.items[0].id);
  }, [sites.items, siteId]);
  const site = sites.items.find((s) => s.id === siteId),
    zone = HONG_KONG_TIMEZONE,
    days = Array.from({ length: 7 }, (_, i) => dayAfter(week, i));
  useEffect(() => {
    if (!site) return;
    let active = true;
    setSelected(new Set());
    setData(null);
    setForm(null);
    api(
      `/sites/${site.id}/roster?from=${encodeURIComponent(localToUtc(`${week}T00:00`, zone))}&to=${encodeURIComponent(localToUtc(`${dayAfter(week, 7)}T00:00`, zone))}`,
    )
      .then((r) => {
        if (active) {
          setData({ ...r, view_week: week });
          setError(null);
        }
      })
      .catch((e) => active && setError(e));
    return () => {
      active = false;
    };
  }, [siteId, week, version, zone]);
  const done = (message) => {
    setForm(null);
    setVersion((x) => x + 1);
    notify(message);
  };
  const publish = async () => {
    try {
      const r = await api(`/sites/${site.id}/roster/publish`, {
        method: "POST",
        body: {
          from: localToUtc(`${week}T00:00`, zone),
          to: localToUtc(`${dayAfter(week, 7)}T00:00`, zone),
        },
      });
      setPublishResult(r);
      setVersion((x) => x + 1);
    } catch (e) {
      setError(e);
      setPublishing(false);
    }
  };
  const find = () => {
    const shifts = data.groups
      .flatMap((g) => g.shifts)
      .filter((s) => selected.has(s.id));
    if (!shifts.length) return;
    if (
      shifts.some(
        (s) =>
          s.start_at !== shifts[0].start_at || s.end_at !== shifts[0].end_at,
      )
    ) {
      setError(Error(t("roster.sameSlot")));
      return;
    }
    onFindStaff({
      site_id: site.id,
      start_at: shifts[0].start_at,
      end_at: shifts[0].end_at,
      open_shift_ids: shifts.map((s) => s.id),
    });
  };
  const visible =
    data?.site?.id === siteId && data?.view_week === week ? data : null;
  const groups = visible?.groups.some((g) => g.staff_id === null)
    ? visible.groups
    : [
        ...(visible?.groups ?? []),
        { staff_id: null, staff_name: null, shifts: [] },
      ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("roster.eyebrow")}</p>
          <h1>{t("roster.title")}</h1>
          <p className="muted">
            {t("roster.intro")}{site && ` ${zone}`}
          </p>
        </div>
        <div className="actions">
          <button
            className="quiet"
            disabled={!visible || !selected.size}
            onClick={find}
          >
            {t("roster.findStaff", { count: selected.size })}
          </button>
          <button
            className="quiet"
            disabled={!site}
            onClick={() => {
              setPublishing(true);
              setPublishResult(null);
            }}
          >
            {t("roster.publishWeek")}
          </button>
          <button
            disabled={!site || site.status !== "active"}
            onClick={() => setForm({})}
          >
            {t("roster.addShift")}
          </button>
        </div>
      </div>
      <ErrorNotice error={error ?? siteError ?? peopleError} />
      <section className="panel">
        <div className="toolbar">
          <PagedSelect
            label={t("roster.siteLabel")}
            value={siteId}
            onChange={(value) => {
              if (value === siteId) return;
              setForm(null);
              setSelected(new Set());
              setData(null);
              setSiteId(value);
            }}
            options={sites.items.map((s) => [s.id, s.name])}
          />
          <input
            aria-label={t("roster.weekStart")}
            type="date"
            value={week}
            onChange={(e) => e.target.value && setWeek(e.target.value)}
          />
          <button className="quiet" onClick={() => setWeek(dayAfter(week, -7))}>
            {t("roster.prevWeek")}
          </button>
          <button className="quiet" onClick={() => setWeek(dayAfter(week, 7))}>
            {t("roster.nextWeek")}
          </button>
        </div>
        <div className="table-wrap">
          <table className="roster-grid">
            <thead>
              <tr>
                <th>{t("common.staff")}</th>
                {days.map((day) => (
                  <th
                    key={day}
                    className={
                      visible?.days?.[day]?.understaffed ? "understaffed" : ""
                    }
                  >
                    {day.slice(5)}
                    {visible?.days?.[day]?.understaffed && (
                      <small>{t("roster.understaffed")}</small>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.staff_id ?? "open"}>
                  <th>{group.staff_name ?? t("roster.openShifts")}</th>
                  {days.map((day) => (
                    <td key={day}>
                      {group.shifts
                        .filter((s) =>
                          utcToLocal(s.start_at, zone).startsWith(day),
                        )
                        .map((shift) => (
                          <div
                            className={`shift ${group.staff_id ? "" : "open"}`}
                            key={shift.id}
                          >
                            {!group.staff_id && (
                              <input
                                aria-label={t("roster.selectOpen", { day })}
                                type="checkbox"
                                checked={selected.has(shift.id)}
                                onChange={(e) =>
                                  setSelected((old) => {
                                    const next = new Set(old);
                                    e.target.checked
                                      ? next.add(shift.id)
                                      : next.delete(shift.id);
                                    return next;
                                  })
                                }
                              />
                            )}
                            <button
                              className="text-button"
                              onClick={() => setForm(shift)}
                            >
                              {utcToLocal(shift.start_at, zone).slice(11)}–
                              {utcToLocal(shift.end_at, zone).slice(11)}
                            </button>
                            <small>
                              {statusText(shift.status)}
                              {utcToLocal(shift.end_at, zone).slice(0, 10) !==
                              day
                                ? t("roster.nextDay")
                                : ""}
                            </small>
                          </div>
                        ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!site && <div className="empty">{t("roster.empty")}</div>}
        </div>
      </section>
      {publishing && (
        <Modal title={t("roster.publishTitle")} onClose={() => setPublishing(false)}>
          {publishResult ? (
            <>
              <p>
                {t("roster.published", {
                  published: publishResult.published,
                  notified: publishResult.notified,
                })}
              </p>
              {publishResult.not_notified.length > 0 && (
                <p className="notice error">
                  {t("roster.notNotified")}
                  {publishResult.not_notified
                    .map(
                      (id) => people.items.find((p) => p.id === id)?.name ?? id,
                    )
                    .join("、")}
                </p>
              )}
              <div className="form-actions">
                <button onClick={() => setPublishing(false)}>{t("roster.done")}</button>
              </div>
            </>
          ) : (
            <>
              <p>
                {t("roster.publishBody")}
              </p>
              <div className="form-actions">
                <button className="quiet" onClick={() => setPublishing(false)}>
                  {t("common.back")}
                </button>
                <button onClick={publish}>{t("roster.confirmPublish")}</button>
              </div>
            </>
          )}
        </Modal>
      )}
      {form && site && (
        <ShiftForm
          site={site}
          staff={people.items}
          shift={form.id ? form : null}
          onDone={done}
          onClose={() => setForm(null)}
        />
      )}
    </>
  );
}
