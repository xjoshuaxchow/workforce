import { RequestVoiceSpeech } from "./ChannelSettingsPage.jsx";
import React, { useEffect, useState } from "react";
import { api, loadAllPages } from "./api.js";
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
const labels = {
  draft: "草稿",
  open: "進行中",
  filled: "已額滿",
  expired: "已截止",
  cancelled: "已取消",
  pending: "待聯絡",
  contacting: "聯絡中",
  accepted: "已接受",
  declined: "已拒絕",
  too_late: "未能接單",
  no_response: "未回覆",
  failed: "失敗",
  skipped: "已略過",
  queued: "待發送",
  sent: "已發出",
  submitting: "正在提交",
  submission_unknown: "提交結果待確認，勿重送",
  delivered: "已送達",
  read: "已讀",
  answered: "已接聽",
  no_answer: "未接聽",
  busy: "忙線",
  no_input: "無按鍵",
  replied: "已回覆",
  published: "已發布",
  confirmed: "已確認",
  completed: "已完成",
};
const fmt = (value, zone) => utcToLocal(value, zone).replace("T", " ");
export function RequestForm({ sites, preset, onClose, onDone }) {
  const [value, setValue] = useState({
      site_id:
        preset?.site_id ?? sites.find((s) => s.status === "active")?.id ?? "",
      mode: preset?.mode ?? "broadcast",
      staff_id: preset?.staff_id ?? "",
      headcount: preset?.open_shift_ids?.length ?? 1,
      voice: true,
      whatsapp: true,
      message: "",
      start: "",
      end: "",
      deadline: "",
    }),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const site = sites.find((s) => s.id === value.site_id),
    zone = HONG_KONG_TIMEZONE;
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
  } = useAllList(`/sites/${value.site_id || "none"}/staff`);
  const timeError =
    value.start && value.end && value.end <= value.start
      ? {
          message: "結束時間必須晚於開始時間",
          errors: [{ field: "end_at", message: "結束時間必須晚於開始時間" }],
        }
      : null;
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
          staff_id: value.staff_id,
          headcount: Number(value.headcount),
          channels: ["whatsapp", "voice"].filter((c) => value[c]),
          message: value.message,
          start_at: localToUtc(value.start, zone),
          end_at: localToUtc(value.end, zone),
          ...(value.deadline
            ? { deadline_at: localToUtc(value.deadline, zone) }
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
    <Modal title="新增調度" onClose={onClose}>
      <p className="muted">所有日期時間均為香港時間</p>
      <ErrorNotice error={timeError ?? error ?? staffError} />
      <form onSubmit={submit}>
        <Field
          label="工作地點"
          value={value.site_id}
          onChange={(v) =>
            setValue((x) => ({
              ...x,
              site_id: v,
              staff_id: preset?.staff_id ?? "",
            }))
          }
          options={sites
            .filter((s) => s.status === "active")
            .filter(
              (s) =>
                value.mode !== "direct" ||
                !preset?.site_ids ||
                preset.site_ids.includes(s.id),
            )
            .map((s) => [s.id, s.name])}
        />
        <div className="form-grid">
          <Field
            label="開始時間"
            type="datetime-local"
            value={value.start}
            onChange={change("start")}
            required
          />
          <Field
            label="結束時間"
            type="datetime-local"
            value={value.end}
            onChange={change("end")}
            required
          />
          <Field
            label="模式"
            value={value.mode}
            onChange={change("mode")}
            options={[
              ["broadcast", "廣播至所有候選人"],
              ["direct", "指定一位員工"],
            ]}
          />
          {value.mode === "direct" ? (
            <Field
              key={value.site_id}
              label="指定員工"
              value={value.staff_id ?? ""}
              onChange={change("staff_id")}
              options={[
                ["", "請選擇"],
                ...staff.items.map((s) => [s.id, s.name]),
              ]}
            />
          ) : (
            <Field
              label="所需人數"
              type="number"
              value={value.headcount}
              onChange={change("headcount")}
              required
            />
          )}
          <Field
            label="回覆截止時間"
            type="datetime-local"
            value={value.deadline}
            onChange={change("deadline")}
          />
        </div>
        <p className="muted">不填截止時間時，會以開始時間為截止。</p>
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
            電話
          </label>
        </div>
        <Field
          label="補充說明"
          value={value.message}
          onChange={change("message")}
        />
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            取消
          </button>
          <button
            disabled={
              busy ||
              Boolean(timeError) ||
              Boolean(staffError) ||
              (value.mode === "direct" && (staffLoading || !value.staff_id))
            }
          >
            {busy ? "建立中…" : "建立草稿"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RequestDetail({ id, onBack, sites, notify, messagingMode }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(null),
    [confirm, setConfirm] = useState(null),
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
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <>
        <ErrorNotice error={error} />
        <p className="muted">載入調度中…</p>
      </>
    );
  const site = sites.find((s) => s.id === data.site_id),
    zone = HONG_KONG_TIMEZONE;
  return (
    <>
      <button className="text-button" onClick={onBack}>
        ← 返回調度列表
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">DISPATCH DETAIL</p>
          <h1>調度詳情</h1>
          <p className="muted">
            {site?.name} · {fmt(data.start_at, zone)} 至{" "}
            {fmt(data.end_at, zone)}
          </p>
        </div>
        <div className="actions">
          {data.status === "draft" && (
            <button disabled={busy || voicePreparing} onClick={() => action(`/requests/${id}/send`)}>{busy || voicePreparing ? "準備及發送中…" : "發送邀請"}</button>
          )}
          {["draft", "open", "filled"].includes(data.status) && (
            <button className="quiet" onClick={() => setConfirm("cancel")}>
              取消調度
            </button>
          )}
        </div>
      </div>
      <ErrorNotice error={error} />
      <div className="dispatch-summary">
        <section className="panel metric">
          <p>已確認人數</p>
          <h2>
            {data.accepted} / {data.headcount}
          </h2>
        </section>
        <section className="panel metric">
          <p>狀態</p>
          <strong className="large-status">{labels[data.status]}</strong>
        </section>
        <section className="panel metric">
          <p>回覆截止 · {zone}</p>
          <strong>{fmt(data.deadline_at, zone)}</strong>
        </section>
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>候選人</h2>
          <span className="muted">每 3 秒更新</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>員工</th>
                <th>接單結果</th>
                <th>WhatsApp</th>
                <th>電話</th>
                <th>回覆時間</th>
                <th>人工處理</th>
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
                      {labels[c.status]}
                    </span>
                    {c.assignment?.status === "cancelled" && (
                      <small>分配已取消</small>
                    )}
                    {c.reason && <small>{c.reason}</small>}
                  </td>
                  {["whatsapp", "voice"].map((channel) => {
                    const attempt = c.attempts.find(
                      (a) => a.channel === channel && a.purpose === "offer",
                    );
                    return (
                      <td key={channel}>
                        {labels[attempt?.status] ?? "—"}
                        {attempt?.response_at && (
                          <small>
                            <time
                              aria-label={
                                channel === "whatsapp"
                                  ? "WhatsApp 回覆時間"
                                  : "電話回覆時間"
                              }
                              dateTime={attempt.response_at}
                            >
                              回覆於 {fmt(attempt.response_at, zone)}
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
                        移除候選人
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
                        確認接單
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
                          移除名額
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.candidates.length && (
            <div className="empty">沒有合資格候選人</div>
          )}
        </div>
      </section>
      {data.status === "draft" && (
        <section className="panel candidate-add">
          <PagedSelect
            label="加入候選員工"
            value={toAdd}
            onChange={setToAdd}
            options={[
              ["", "選擇 Site 關聯員工"],
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
            加入候選人
          </button>
        </section>
      )}
      <RequestVoiceSpeech request={data} onPreparing={setVoicePreparing} />
      {data.excluded?.length > 0 && (
        <section className="panel exclusions">
          <h2>未納入的員工</h2>
          {data.excluded.map((x) => (
            <p key={x.staff_id}>
              {x.name} · {x.reason}
            </p>
          ))}
        </section>
      )}
      {import.meta.env.DEV && messagingMode === "mock" && (
        <details className="panel dev-tools">
          <summary>本機測試工具</summary>
          <p className="muted">此區只模擬回覆，不會發出真實電話或 WhatsApp。</p>
          {data.candidates.map((c) => (
            <div className="mock-row" key={c.id}>
              <strong>{c.name}</strong>
              {c.attempts
                .filter((a) => a.purpose === "offer")
                .map((a) => (
                  <div key={a.id} className="actions">
                    <span>{a.channel === "voice" ? "電話" : "WhatsApp"}</span>
                    <button
                      className="quiet"
                      onClick={() =>
                        action(`/mock/attempts/${a.id}/events`, {
                          type: "reply",
                          option_id: "ACCEPT",
                        })
                      }
                    >
                      模擬接受
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
                      模擬拒絕
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
                        模擬未接
                      </button>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </details>
      )}
      {confirm && (
        <Modal
          title={
            confirm === "send"
              ? "確認發送"
              : confirm === "cancel"
                ? "取消調度"
                : "確認人工處理"
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === "send"
              ? `將向 ${data.candidates.length} 位候選人發出 ${data.channels.map((c) => (c === "voice" ? "電話" : "WhatsApp")).join("／")} 邀請。`
              : confirm === "cancel"
                ? "已接單的分配也會取消，並發出取消通知。"
                : confirm.kind === "remove"
                  ? `移除 ${confirm.candidate.name} 的名額，並發出取消通知。`
                  : `為 ${confirm.candidate.name} 正式接單，仍會檢查剩餘名額及班次衝突。`}
          </p>
          <div className="form-actions">
            <button className="quiet" onClick={() => setConfirm(null)}>
              返回
            </button>
            <button
              disabled={busy}
              onClick={() =>
                action(
                  `/requests/${id}/${typeof confirm === "string" ? confirm : `candidates/${confirm.candidate.id}/${confirm.kind}`}`,
                )
              }
            >
              {confirm === "send" ? "確認發送" : "確認"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Requests({ notify, preset, onPresetUsed, messagingMode }) {
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
    notify("調度草稿已建立");
  };
  if (selected)
    return (
      <RequestDetail
        messagingMode={messagingMode}
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
          <p className="eyebrow">DISPATCH</p>
          <h1>調度工作台</h1>
          <p className="muted">發出工作邀請，追蹤各渠道結果與已確認名額。</p>
        </div>
        <button
          disabled={!sites.items.some((s) => s.status === "active")}
          onClick={() => setForm(true)}
        >
          新增調度
        </button>
      </div>
      <ErrorNotice error={error ?? siteError} />
      <section className="panel">
        <div className="toolbar">
          <select
            aria-label="調度狀態"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">所有狀態</option>
            {["draft", "open", "filled", "expired", "cancelled"].map((k) => (
              <option key={k} value={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>工作地點</th>
                <th>時段</th>
                <th>已確認／所需</th>
                <th>狀態</th>
                <th>建立者</th>
                <th>操作</th>
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
                      至{" "}
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
                      {labels[r.status]}
                    </span>
                  </td>
                  <td>{r.created_by_name}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setSelected(r.id)}
                    >
                      查看詳情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length && (
            <div className="empty">
              {loading ? "載入中…" : "尚未建立調度，先新增工作地點及關聯員工。"}
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
      onDone("班次已儲存");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={shift ? "編輯班次" : "新增班次"} onClose={onClose}>
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
            此班次由調度管理；換人、改時段或取消，請到原調度處理。
          </p>
        )}
        <Field
          disabled={Boolean(shift?.request_id)}
          label="指派員工"
          value={value.staff_id}
          onChange={change("staff_id")}
          options={[
            ["", "未指派 Open shift"],
            ...staff.map((s) => [s.id, s.name]),
          ]}
        />
        <div className="form-grid">
          <Field
            disabled={Boolean(shift?.request_id)}
            label="開始時間"
            type="datetime-local"
            required
            value={value.start}
            onChange={change("start")}
          />
          <Field
            disabled={Boolean(shift?.request_id)}
            label="結束時間"
            type="datetime-local"
            required
            value={value.end}
            onChange={change("end")}
          />
        </div>
        <Field label="備註" value={value.notes} onChange={change("notes")} />
        {error?.warnings && (
          <div className="notice error">
            {error.warnings.join("、")}
            <button type="button" className="quiet" onClick={() => save(true)}>
              確認警告並指派
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
                  if (!window.confirm("取消這個班次？")) return;
                  try {
                    await api(`/shifts/${shift.id}/cancel`, {
                      method: "POST",
                      body: {},
                    });
                    onDone("班次已取消");
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                取消班次
              </button>
            )}
          <button type="button" className="quiet" onClick={onClose}>
            返回
          </button>
          <button disabled={busy}>儲存</button>
        </div>
      </form>
    </Modal>
  );
}
export function Roster({ notify, onFindStaff }) {
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
      setError(Error("請選擇相同時段的空缺班次"));
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
          <p className="eyebrow">ROSTER</p>
          <h1>班表</h1>
          <p className="muted">
            以工作地點當地時間查看班次與缺額。{site && ` ${zone}`}
          </p>
        </div>
        <div className="actions">
          <button
            className="quiet"
            disabled={!visible || !selected.size}
            onClick={find}
          >
            為 {selected.size} 個空缺尋找員工
          </button>
          <button
            className="quiet"
            disabled={!site}
            onClick={() => {
              setPublishing(true);
              setPublishResult(null);
            }}
          >
            發布本週
          </button>
          <button
            disabled={!site || site.status !== "active"}
            onClick={() => setForm({})}
          >
            新增班次
          </button>
        </div>
      </div>
      <ErrorNotice error={error ?? siteError ?? peopleError} />
      <section className="panel">
        <div className="toolbar">
          <PagedSelect
            label="班表地點"
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
            aria-label="班表起始日期"
            type="date"
            value={week}
            onChange={(e) => e.target.value && setWeek(e.target.value)}
          />
          <button className="quiet" onClick={() => setWeek(dayAfter(week, -7))}>
            上一週
          </button>
          <button className="quiet" onClick={() => setWeek(dayAfter(week, 7))}>
            下一週
          </button>
        </div>
        <div className="table-wrap">
          <table className="roster-grid">
            <thead>
              <tr>
                <th>員工</th>
                {days.map((day) => (
                  <th
                    key={day}
                    className={
                      visible?.days?.[day]?.understaffed ? "understaffed" : ""
                    }
                  >
                    {day.slice(5)}
                    {visible?.days?.[day]?.understaffed && (
                      <small>有缺額</small>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.staff_id ?? "open"}>
                  <th>{group.staff_name ?? "空缺班次"}</th>
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
                                aria-label={`選擇 ${day} 空缺`}
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
                              {labels[shift.status]}
                              {utcToLocal(shift.end_at, zone).slice(0, 10) !==
                              day
                                ? " · 翌日"
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
          {!site && <div className="empty">先建立工作地點，即可開始排班。</div>}
        </div>
      </section>
      {publishing && (
        <Modal title="發布本週班表" onClose={() => setPublishing(false)}>
          {publishResult ? (
            <>
              <p>
                已發布 {publishResult.published} 個班次，已安排通知{" "}
                {publishResult.notified} 位員工。
              </p>
              {publishResult.not_notified.length > 0 && (
                <p className="notice error">
                  未能透過 WhatsApp 通知：
                  {publishResult.not_notified
                    .map(
                      (id) => people.items.find((p) => p.id === id)?.name ?? id,
                    )
                    .join("、")}
                </p>
              )}
              <div className="form-actions">
                <button onClick={() => setPublishing(false)}>完成</button>
              </div>
            </>
          ) : (
            <>
              <p>
                發布本週草稿班次，並為每位符合 WhatsApp
                聯絡條件的員工安排一則通知。
              </p>
              <div className="form-actions">
                <button className="quiet" onClick={() => setPublishing(false)}>
                  返回
                </button>
                <button onClick={publish}>確認發布</button>
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
