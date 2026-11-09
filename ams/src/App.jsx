import React, { useEffect, useState } from "react";
import { api, loadAllPages } from "./api.js";
import {
  ChannelSettingsPage,
  languages as channelLanguages,
} from "./ChannelSettingsPage.jsx";
import { Requests, Roster } from "./DispatchPages.jsx";

const statusLabels = {
  active: "可聯絡",
  on_leave: "休假",
  blocked: "已封鎖",
  inactive: "已停用",
};
import {
  ErrorNotice,
  Field,
  Modal,
  Pager,
  useList,
  useAllList,
  PagedItems,
  mutationNotice,
} from "./ui.jsx";
function CSVImport({ path, onDone, onClose, description }) {
  const [file, setFile] = useState(null),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (!file) throw Error("請選擇 CSV 檔案");
      const result = await api(path, {
        method: "POST",
        body: { csv: await file.text() },
      });
      onDone(result);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="匯入 CSV" onClose={onClose}>
      <p className="muted">{description}</p>
      <p className="muted">最多 5,000 行、5 MB；所有資料驗證成功後才會匯入。</p>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        <Field label="CSV 檔案">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files[0])}
          />
        </Field>
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            取消
          </button>
          <button disabled={busy}>{busy ? "匯入中…" : "確認匯入"}</button>
        </div>
      </form>
    </Modal>
  );
}
function StaffForm({ staff, onDone, onClose }) {
  const [value, setValue] = useState(
      staff ?? {
        name: "",
        mobile: "",
        landline: "",
        language: "en",
        preferred_channel: "whatsapp",
        status: "active",
        whatsapp_opt_in: false,
        whatsapp_opt_in_source: "",
      },
    ),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const change = (key) => (v) => setValue((x) => ({ ...x, [key]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const mobile = value.mobile.replace(/[\s-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(mobile)) {
      setError({
        message: "請檢查資料",
        errors: [
          {
            field: "mobile",
            message: "手機號碼須含國家代碼，例如 +6591234567",
          },
        ],
      });
      return;
    }
    setBusy(true);
    try {
      const result = await api(staff ? `/staff/${staff.id}` : "/staff", {
        method: staff ? "PATCH" : "POST",
        body: {
          ...value,
          landline: value.landline || null,
          whatsapp_opt_in_source: value.whatsapp_opt_in_source || null,
        },
      });
      onDone(mutationNotice("員工資料已儲存", result.warnings));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={staff ? "編輯員工" : "新增員工"} onClose={onClose}>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="姓名"
            value={value.name}
            onChange={change("name")}
            required
          />
          <Field
            label="手機號碼"
            value={value.mobile}
            onChange={change("mobile")}
            required
          />
          <Field
            label="固網號碼"
            value={value.landline}
            onChange={change("landline")}
          />
          <Field
            label="語言代碼"
            options={
              channelLanguages.some((x) => x[0] === value.language)
                ? channelLanguages
                : [
                    ...channelLanguages,
                    [value.language, value.language + "（未設定內容）"],
                  ]
            }
            value={value.language}
            onChange={change("language")}
            required
          />
          <Field
            label="偏好渠道"
            value={value.preferred_channel}
            onChange={change("preferred_channel")}
            options={[
              ["whatsapp", "WhatsApp"],
              ["voice", "電話"],
            ]}
          />
          <Field
            label="狀態"
            value={value.status}
            onChange={change("status")}
            options={Object.entries(statusLabels)}
          />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={value.whatsapp_opt_in}
            onChange={(e) => change("whatsapp_opt_in")(e.target.checked)}
          />
          已取得 WhatsApp 聯絡同意
        </label>
        {value.whatsapp_opt_in && (
          <Field
            label="同意來源"
            value={value.whatsapp_opt_in_source}
            onChange={change("whatsapp_opt_in_source")}
            required
          />
        )}
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            取消
          </button>
          <button disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
        </div>
      </form>
    </Modal>
  );
}
function Staff({ user, notify, onContact }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [form, setForm] = useState(null),
    [importing, setImporting] = useState(false),
    [contacting, setContacting] = useState(null),
    [contactError, setContactError] = useState(null);
  const contact = async (staff) => {
    setContacting(staff.id);
    setContactError(null);
    try {
      const { items } = await loadAllPages(`/staff/${staff.id}/sites`);
      const sites = items.filter((s) => s.status === "active");
      if (!sites.length) throw Error("請先將此員工關聯到啟用的工作地點");
      onContact({
        mode: "direct",
        staff_id: staff.id,
        site_id: sites[0].id,
        site_ids: sites.map((s) => s.id),
      });
    } catch (error) {
      setContactError(error);
    } finally {
      setContacting(null);
    }
  };
  const { data, error, loading } = useList(
    `/staff?search=${encodeURIComponent(search)}&status=${status}&page=${page}`,
    version,
  );
  const done = (message) => {
    setVersion((x) => x + 1);
    setForm(null);
    setImporting(false);
    notify(message);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PEOPLE</p>
          <h1>員工管理</h1>
          <p className="muted">維護聯絡資料、可聯絡狀態與工作地點關聯。</p>
        </div>
        {user.role === "admin" && (
          <div className="actions">
            <button className="quiet" onClick={() => setImporting(true)}>
              匯入 CSV
            </button>
            <button onClick={() => setForm({})}>新增員工</button>
          </div>
        )}
      </div>
      <ErrorNotice error={contactError ?? error} />
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="搜尋員工"
            placeholder="搜尋姓名或手機號碼"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="篩選狀態"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">所有啟用員工</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>員工</th>
                <th>手機號碼</th>
                <th>狀態</th>
                <th>WhatsApp 同意</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <small>
                      {s.language.toUpperCase()} ·{" "}
                      {s.preferred_channel === "voice" ? "電話" : "WhatsApp"}
                    </small>
                  </td>
                  <td>{s.mobile}</td>
                  <td>
                    <span
                      className={`badge ${s.status === "active" ? "success" : ""}`}
                    >
                      {statusLabels[s.status]}
                    </span>
                  </td>
                  <td>{s.whatsapp_opt_in ? "已同意" : "未同意"}</td>
                  <td>
                    <button
                      className="text-button"
                      disabled={staffContactDisabled(s, contacting)}
                      onClick={() => contact(s)}
                    >
                      直接邀請
                    </button>
                    {user.role === "admin" && (
                      <button
                        className="text-button"
                        onClick={() => setForm(s)}
                      >
                        編輯
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length && (
            <div className="empty">
              {loading ? "載入中…" : "暫無符合條件的員工"}
            </div>
          )}
        </div>
        <Pager data={data} page={page} onChange={setPage} />
      </section>
      {form && (
        <StaffForm
          staff={form.id ? form : null}
          onDone={done}
          onClose={() => setForm(null)}
        />
      )}
      {importing && (
        <CSVImport
          path="/staff/import"
          description="必要欄位：name、mobile。可另填 language、preferred_channel、whatsapp_opt_in 及 whatsapp_opt_in_source。"
          onDone={(r) => done(`已匯入 ${r.created} 位員工`)}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
const staffContactDisabled = (staff, contacting) =>
  staff.status !== "active" || contacting !== null;
function SiteForm({ site, onDone, onClose }) {
  const [value, setValue] = useState(
      site ?? {
        code: "",
        name: "",
        address: "",
        voice_name_en: "",
        voice_address_en: "",
        timezone: "Asia/Singapore",
        status: "active",
      },
    ),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const change = (key) => (v) => setValue((x) => ({ ...x, [key]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(site ? `/sites/${site.id}` : "/sites", {
        method: site ? "PATCH" : "POST",
        body: value,
      });
      onDone("地點資料已儲存");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={site ? "編輯地點" : "新增地點"} onClose={onClose}>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="代碼"
            value={value.code}
            onChange={change("code")}
            required
          />
          <Field
            label="地點名稱"
            value={value.name}
            onChange={change("name")}
            required
          />
          <Field
            label="時區"
            value={value.timezone}
            onChange={change("timezone")}
            required
          />
          <Field
            label="狀態"
            value={value.status}
            onChange={change("status")}
            options={[
              ["active", "啟用"],
              ["inactive", "停用"],
            ]}
          />
        </div>
        <Field
          label="地址"
          value={value.address}
          onChange={change("address")}
        />
        <Field label="英文朗讀名稱" value={value.voice_name_en ?? ""} onChange={change("voice_name_en")} />
        <Field label="英文朗讀地址" value={value.voice_address_en ?? ""} onChange={change("voice_address_en")} />
        <p className="muted">只用於英語電話 MP3，原有地點名稱及地址保持不變。原資料已是英文時可留空。</p>
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            取消
          </button>
          <button disabled={busy}>儲存</button>
        </div>
      </form>
    </Modal>
  );
}
function LinkForm({ site, onDone, onClose }) {
  const { data, error, loading: staffLoading } = useAllList("/staff"),
    [selected, setSelected] = useState(new Set()),
    [initial, setInitial] = useState(new Set()),
    [loading, setLoading] = useState(true),
    [failure, setFailure] = useState(null),
    [initialError, setInitialError] = useState(null);
  useEffect(() => {
    let active = true;
    loadAllPages(`/sites/${site.id}/staff`)
      .then((r) => {
        if (active) {
          const ids = new Set(r.items.map((x) => x.id));
          setSelected(ids);
          setInitial(ids);
          setLoading(false);
        }
      })
      .catch((e) => active && setInitialError(e));
    return () => {
      active = false;
    };
  }, [site.id]);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFailure(null);
    try {
      if (selected.size)
        await api(`/sites/${site.id}/staff`, {
          method: "POST",
          body: { staff_ids: [...selected] },
        });
      const warnings = [];
      for (const id of initial)
        if (!selected.has(id)) {
          const r = await api(`/sites/${site.id}/staff/${id}`, {
            method: "DELETE",
          });
          warnings.push(...(r.warnings ?? []));
        }
      onDone(mutationNotice("員工關聯已儲存", warnings));
    } catch (e) {
      setFailure(e);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal title={`${site.name} 員工關聯`} onClose={onClose}>
      <p className="muted">勾選獲准在此地點工作的員工。</p>
      <ErrorNotice error={initialError ?? failure ?? error} />
      <form onSubmit={submit}>
        <PagedItems label="關聯員工" items={data.items}>
          {(s) => (
            <label className="checkbox" key={s.id}>
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={(e) =>
                  setSelected((old) => {
                    const next = new Set(old);
                    e.target.checked ? next.add(s.id) : next.delete(s.id);
                    return next;
                  })
                }
              />
              {s.name}
              <span className="muted">{s.mobile}</span>
            </label>
          )}
        </PagedItems>
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            取消
          </button>
          <button
            disabled={
              loading || staffLoading || Boolean(error) || Boolean(initialError)
            }
          >
            儲存關聯
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Sites({ user, notify }) {
  const [version, setVersion] = useState(0),
    [page, setPage] = useState(1),
    [form, setForm] = useState(null),
    [link, setLink] = useState(null),
    [importing, setImporting] = useState(false);
  const { data, error, loading } = useList(`/sites?page=${page}`, version);
  const done = (message) => {
    setVersion((x) => x + 1);
    setForm(null);
    setLink(null);
    setImporting(false);
    notify(message);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LOCATIONS</p>
          <h1>工作地點</h1>
          <p className="muted">管理 Site、當地時區與可工作員工。</p>
        </div>
        {user.role === "admin" && (
          <div className="actions">
            <button className="quiet" onClick={() => setImporting(true)}>
              匯入員工關聯
            </button>
            <button onClick={() => setForm({})}>新增地點</button>
          </div>
        )}
      </div>
      <ErrorNotice error={error} />
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>地點</th>
              <th>代碼</th>
              <th>時區</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  <small>{s.address || "未填地址"}</small>
                </td>
                <td>{s.code}</td>
                <td>{s.timezone}</td>
                <td>
                  <span
                    className={`badge ${s.status === "active" ? "success" : ""}`}
                  >
                    {s.status === "active" ? "啟用" : "停用"}
                  </span>
                </td>
                <td>
                  {user.role === "admin" && (
                    <div className="actions">
                      <button
                        className="text-button"
                        onClick={() => setForm(s)}
                      >
                        編輯
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setLink(s)}
                      >
                        管理員工
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.items.length && (
          <div className="empty">
            {loading ? "載入中…" : "尚未建立工作地點"}
          </div>
        )}
        <Pager data={data} page={page} onChange={setPage} />
      </section>
      {form && (
        <SiteForm
          site={form.id ? form : null}
          onDone={done}
          onClose={() => setForm(null)}
        />
      )}
      {link && (
        <LinkForm site={link} onDone={done} onClose={() => setLink(null)} />
      )}
      {importing && (
        <CSVImport
          path="/links/import"
          description="必要欄位：site_code、staff_mobile。既有關聯不會重複建立。"
          onDone={(r) =>
            done(`新增 ${r.linked} 個關聯，${r.already_linked} 個已存在`)
          }
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
function Users({ notify }) {
  const [version, setVersion] = useState(0),
    [form, setForm] = useState(false),
    [error, setError] = useState(null),
    [value, setValue] = useState({
      email: "",
      name: "",
      password: "",
      role: "site_manager",
    }),
    [assignment, setAssignment] = useState(null),
    [site, setSite] = useState(""),
    [page, setPage] = useState(1);
  const [grants, setGrants] = useState([]);
  useEffect(() => {
    let active = true;
    setGrants([]);
    if (assignment)
      loadAllPages(`/users/${assignment.id}/sites`)
        .then((r) => active && setGrants(r.items))
        .catch((e) => active && setError(e));
    return () => {
      active = false;
    };
  }, [assignment?.id]);
  const { data, error: listError } = useList(`/users?page=${page}`, version),
    { data: sites, error: siteError } = useAllList("/sites");
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api("/users", { method: "POST", body: value });
      setForm(false);
      setValue({ email: "", name: "", password: "", role: "site_manager" });
      setVersion((x) => x + 1);
      notify("帳戶已建立");
    } catch (e) {
      setError(e);
    }
  };
  const assign = async (e) => {
    e.preventDefault();
    try {
      await api(`/users/${assignment.id}/sites`, {
        method: "POST",
        body: { site_id: site },
      });
      setAssignment(null);
      notify("Site 授權已儲存");
    } catch (e) {
      setError(e);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACCESS</p>
          <h1>帳戶與權限</h1>
          <p className="muted">管理員工調度系統的登入帳戶與 Site 授權。</p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setForm(true);
          }}
        >
          新增帳戶
        </button>
      </div>
      <ErrorNotice error={listError ?? siteError} />
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>電郵</th>
              <th>角色</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role === "admin" ? "管理員" : "Site Manager"}</td>
                <td>
                  {u.role === "site_manager" && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setAssignment(u);
                        setSite(sites.items[0]?.id ?? "");
                        setError(null);
                      }}
                    >
                      授權地點
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager data={data} page={page} onChange={setPage} />
      </section>
      {form && (
        <Modal title="新增帳戶" onClose={() => setForm(false)}>
          <ErrorNotice error={error} />
          <form onSubmit={submit}>
            {[
              ["姓名", "name", "text"],
              ["電郵", "email", "email"],
              ["密碼", "password", "password"],
            ].map(([label, key, type]) => (
              <Field
                key={key}
                label={label}
                type={type}
                required
                value={value[key]}
                onChange={(v) => setValue((x) => ({ ...x, [key]: v }))}
              />
            ))}
            <p className="muted">密碼至少 12 個字元。</p>
            <Field
              label="角色"
              value={value.role}
              onChange={(v) => setValue((x) => ({ ...x, role: v }))}
              options={[
                ["site_manager", "Site Manager"],
                ["admin", "管理員"],
              ]}
            />
            <div className="form-actions">
              <button>建立帳戶</button>
            </div>
          </form>
        </Modal>
      )}
      {assignment && (
        <Modal
          title={`${assignment.name} 的地點授權`}
          onClose={() => setAssignment(null)}
        >
          <ErrorNotice error={error} />
          <div className="check-list">
            {grants.map((s) => (
              <div className="grant-row" key={s.id}>
                <span>{s.name}</span>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api(`/users/${assignment.id}/sites/${s.id}`, {
                        method: "DELETE",
                      });
                      setGrants((old) => old.filter((x) => x.id !== s.id));
                      notify("Site 授權已撤銷");
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  撤銷授權
                </button>
              </div>
            ))}
          </div>
          <form onSubmit={assign}>
            <Field
              label="地點"
              value={site}
              onChange={setSite}
              options={sites.items.map((s) => [s.id, s.name])}
            />
            <div className="form-actions">
              <button disabled={!site}>儲存授權</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Audit() {
  const [page, setPage] = useState(1);
  const { data, error } = useList(`/audit?page=${page}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACTIVITY</p>
          <h1>操作紀錄</h1>
          <p className="muted">查看有權存取的資料變更與操作時間。</p>
        </div>
      </div>
      <ErrorNotice error={error} />
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>時間</th>
              <th>操作</th>
              <th>資料類型</th>
              <th>操作者</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.at).toLocaleString("zh-HK")}</td>
                <td>{a.action}</td>
                <td>{a.entity_type}</td>
                <td>{a.actor_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager data={data} page={page} onChange={setPage} />
      </section>
    </>
  );
}
export function App() {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("staff"),
    [error, setError] = useState(null),
    [notice, setNotice] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [preset, setPreset] = useState(null),
    [messaging, setMessaging] = useState(null);
  useEffect(() => {
    let active = true;
    setMessaging(null);
    if (!user) return;
    const refresh = () =>
      api("/messaging/status")
        .then((value) => {
          if (active) setMessaging(value);
        })
        .catch(() => {
          if (active) setMessaging(null);
        });
    refresh();
    const timer = setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user]);
  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
    const handler = () => {
      setUser(null);
      setNotice("");
    };
    window.addEventListener("workforce:unauthorized", handler);
    return () => window.removeEventListener("workforce:unauthorized", handler);
  }, []);
  const login = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setUser(
        (
          await api("/auth/login", {
            method: "POST",
            body: { email, password },
          })
        ).user,
      );
      setPassword("");
      setPage("staff");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
      setUser(null);
      setNotice("");
    } catch (e) {
      setError(e);
    }
  };
  if (loading) return <main className="loading">載入中…</main>;
  if (!user)
    return (
      <main className="login-layout">
        <section className="login-intro">
          <span className="brand-mark">W</span>
          <p className="eyebrow">WORKFORCE</p>
          <h1>
            讓每個班次
            <br />
            找到合適的人
          </h1>
          <p>員工、地點與排班，從同一個工作台開始。</p>
        </section>
        <section className="login-card">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>登入工作台</h2>
          <p className="muted">使用你的員工調度管理帳戶。</p>
          <ErrorNotice error={error} />
          <form onSubmit={login}>
            <Field
              label="電郵"
              type="email"
              value={email}
              onChange={setEmail}
              required
            />
            <Field
              label="密碼"
              type="password"
              value={password}
              onChange={setPassword}
              required
            />
            <button className="full-width" disabled={busy}>
              {busy ? "登入中…" : "登入"}
            </button>
          </form>
        </section>
      </main>
    );
  const nav = [
    ["requests", "調度工作台"],
    ["roster", "班表"],
    ["staff", "員工管理"],
    ["sites", "工作地點"],
    ...(user.role === "admin"
      ? [
          ["users", "帳戶與權限"],
          ["settings", "通訊設定"],
        ]
      : []),
    ["audit", "操作紀錄"],
  ];
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">W</span>
          <span>
            WORKFORCE<small>員工調度與排班</small>
          </span>
        </div>
        <nav aria-label="主要導覽">
          {nav.map(([key, label]) => (
            <button
              key={key}
              aria-current={page === key ? "page" : undefined}
              className={page === key ? "selected" : ""}
              onClick={() => {
                setPage(key);
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="account">
          <strong>{user.name}</strong>
          <small>{user.role === "admin" ? "管理員" : "Site Manager"}</small>
          <button className="quiet" onClick={logout}>
            登出
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="topbar">
          <span>工作台</span>
          <span aria-label="傳送模式">
            {messaging
              ? `電話：${messaging.voice === "twilio" ? "Twilio PSTN 真實撥號" : "模擬"} · WhatsApp：${messaging.whatsapp === "service" ? "microservice 真實發送" : "模擬"}`
              : "傳送模式未確認"}
          </span>
          <span>
            {new Date().toLocaleDateString("zh-HK", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>
        {notice && (
          <div role="status" className="notice success">
            {notice}
          </div>
        )}
        {page === "requests" && (
          <Requests
            notify={setNotice}
            messagingMode={messaging?.mode}
            preset={preset}
            onPresetUsed={() => setPreset(null)}
          />
        )}
        {page === "roster" && (
          <Roster
            notify={setNotice}
            onFindStaff={(value) => {
              setPreset(value);
              setPage("requests");
            }}
          />
        )}
        {page === "staff" && (
          <Staff
            user={user}
            notify={setNotice}
            onContact={(value) => {
              setPreset(value);
              setPage("requests");
            }}
          />
        )}
        {page === "sites" && <Sites user={user} notify={setNotice} />}
        {page === "users" && <Users notify={setNotice} />}
        {page === "audit" && <Audit />}
        {page === "settings" && user.role === "admin" && (
          <ChannelSettingsPage notify={setNotice} />
        )}
      </main>
    </div>
  );
}
