import React, { useEffect, useState } from "react";
import { api, loadAllPages } from "./api.js";
import { formatDate, t } from "./i18n.js";
import { LocaleSwitch, useI18n } from "./i18n.jsx";
import {
  ChannelSettingsPage,
  languageCodes,
  languageOptions,
} from "./ChannelSettingsPage.jsx";
import { Requests, Roster } from "./DispatchPages.jsx";

const staffStatuses = ["active", "on_leave", "blocked", "inactive"];
const staffStatusOptions = () => staffStatuses.map((code) => [code, t(`staff.status.${code}`)]);
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
  useI18n();
  const [file, setFile] = useState(null),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (!file) throw Error(t("csv.choose"));
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
    <Modal title={t("csv.title")} onClose={onClose}>
      <p className="muted">{description}</p>
      <p className="muted">{t("csv.limit")}</p>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        <Field label={t("csv.file")}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files[0])}
          />
        </Field>
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button disabled={busy}>{busy ? t("csv.importing") : t("csv.confirm")}</button>
        </div>
      </form>
    </Modal>
  );
}
function StaffForm({ staff, onDone, onClose }) {
  useI18n();
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
        message: t("staff.checkData"),
        errors: [
          {
            field: "mobile",
            message: t("staff.mobileInvalid"),
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
      onDone(mutationNotice(t("staff.saved"), result.warnings));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={staff ? t("staff.editTitle") : t("staff.createTitle")} onClose={onClose}>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field
            label={t("common.name")}
            value={value.name}
            onChange={change("name")}
            required
          />
          <Field
            label={t("staff.mobile")}
            value={value.mobile}
            onChange={change("mobile")}
            required
          />
          <Field
            label={t("staff.landline")}
            value={value.landline}
            onChange={change("landline")}
          />
          <Field
            label={t("staff.language")}
            options={
              languageCodes.includes(value.language)
                ? languageOptions()
                : [
                    ...languageOptions(),
                    [value.language, value.language + t("language.unset")],
                  ]
            }
            value={value.language}
            onChange={change("language")}
            required
          />
          <Field
            label={t("staff.preferredChannel")}
            value={value.preferred_channel}
            onChange={change("preferred_channel")}
            options={[
              ["whatsapp", t("common.whatsapp")],
              ["voice", t("common.voice")],
            ]}
          />
          <Field
            label={t("common.status")}
            value={value.status}
            onChange={change("status")}
            options={staffStatusOptions()}
          />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={value.whatsapp_opt_in}
            onChange={(e) => change("whatsapp_opt_in")(e.target.checked)}
          />
          {t("staff.optIn")}
        </label>
        <p className="muted">{t("staff.optInHint")}</p>
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
function Staff({ user, notify, onContact }) {
  useI18n();
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
      if (!sites.length) throw Error(t("staff.linkFirst"));
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
          <p className="eyebrow">{t("staff.eyebrow")}</p>
          <h1>{t("staff.title")}</h1>
          <p className="muted">{t("staff.intro")}</p>
        </div>
        {user.role === "admin" && (
          <div className="actions">
            <button className="quiet" onClick={() => setImporting(true)}>
              {t("staff.import")}
            </button>
            <button onClick={() => setForm({})}>{t("staff.add")}</button>
          </div>
        )}
      </div>
      <ErrorNotice error={contactError ?? error} />
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label={t("staff.search")}
            placeholder={t("common.searchPeople")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label={t("staff.filterStatus")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("staff.allActive")}</option>
            {staffStatusOptions().map(([value, label]) => (
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
                <th>{t("common.staff")}</th>
                <th>{t("staff.mobile")}</th>
                <th>{t("common.status")}</th>
                <th>{t("staff.optInColumn")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <small>
                      {s.language.toUpperCase()} ·{" "}
                      {s.preferred_channel === "voice" ? t("common.voice") : t("common.whatsapp")}
                    </small>
                  </td>
                  <td>{s.mobile}</td>
                  <td>
                    <span
                      className={`badge ${s.status === "active" ? "success" : ""}`}
                    >
                      {t(`staff.status.${s.status}`)}
                    </span>
                  </td>
                  <td>{s.whatsapp_opt_in ? t("staff.optedIn") : t("staff.optedOut")}</td>
                  <td>
                    <button
                      className="text-button"
                      disabled={staffContactDisabled(s, contacting)}
                      onClick={() => contact(s)}
                    >
                      {t("staff.invite")}
                    </button>
                    {user.role === "admin" && (
                      <button
                        className="text-button"
                        onClick={() => setForm(s)}
                      >
                        {t("common.edit")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length && (
            <div className="empty">
              {loading ? t("common.loading") : t("staff.empty")}
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
          description={t("staff.importHelp")}
          onDone={(r) => done(t("staff.imported", { count: r.created }))}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
const staffContactDisabled = (staff, contacting) =>
  staff.status !== "active" || contacting !== null;
function SiteForm({ site, onDone, onClose }) {
  useI18n();
  const [value, setValue] = useState(
      site ?? {
        code: "",
        name: "",
        address: "",
        voice_name_en: "",
        voice_address_en: "",
        timezone: "Asia/Hong_Kong",
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
        body: { ...value, timezone: value.timezone ?? "Asia/Hong_Kong" },
      });
      onDone(t("site.saved"));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={site ? t("site.editTitle") : t("site.createTitle")} onClose={onClose}>
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field
            label={t("site.code")}
            value={value.code}
            onChange={change("code")}
            required
          />
          <Field
            label={t("site.name")}
            value={value.name}
            onChange={change("name")}
            required
          />
          <Field
            label={t("common.status")}
            value={value.status}
            onChange={change("status")}
            options={[
              ["active", t("site.status.active")],
              ["inactive", t("site.status.inactive")],
            ]}
          />
        </div>
        <Field
          label={t("site.address")}
          value={value.address}
          onChange={change("address")}
        />
        <Field label={t("site.voiceName")} value={value.voice_name_en ?? ""} onChange={change("voice_name_en")} />
        <Field label={t("site.voiceAddress")} value={value.voice_address_en ?? ""} onChange={change("voice_address_en")} />
        <p className="muted">{t("site.voiceHint")}</p>
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button disabled={busy}>{t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
function LinkForm({ site, onDone, onClose }) {
  useI18n();
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
      onDone(mutationNotice(t("site.linkSaved"), warnings));
    } catch (e) {
      setFailure(e);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal title={t("site.linkTitle", { name: site.name })} onClose={onClose}>
      <p className="muted">{t("site.linkHint")}</p>
      <ErrorNotice error={initialError ?? failure ?? error} />
      <form onSubmit={submit}>
        <PagedItems label={t("site.linkLabel")} items={data.items}>
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
            {t("common.cancel")}
          </button>
          <button
            disabled={
              loading || staffLoading || Boolean(error) || Boolean(initialError)
            }
          >
            {t("site.saveLinks")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Sites({ user, notify }) {
  useI18n();
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
          <p className="eyebrow">{t("site.eyebrow")}</p>
          <h1>{t("site.title")}</h1>
          <p className="muted">{t("site.intro")}</p>
        </div>
        {user.role === "admin" && (
          <div className="actions">
            <button className="quiet" onClick={() => setImporting(true)}>
              {t("site.importLinks")}
            </button>
            <button onClick={() => setForm({})}>{t("site.add")}</button>
          </div>
        )}
      </div>
      <ErrorNotice error={error} />
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("site.columnSite")}</th>
              <th>{t("site.columnCode")}</th>
              <th>{t("site.columnTime")}</th>
              <th>{t("common.status")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  <small>{s.address || t("site.noAddress")}</small>
                </td>
                <td>{s.code}</td>
                <td>{t("common.hongKongTime")}</td>
                <td>
                  <span
                    className={`badge ${s.status === "active" ? "success" : ""}`}
                  >
                    {s.status === "active" ? t("site.status.active") : t("site.status.inactive")}
                  </span>
                </td>
                <td>
                  {user.role === "admin" && (
                    <div className="actions">
                      <button
                        className="text-button"
                        onClick={() => setForm(s)}
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setLink(s)}
                      >
                        {t("site.manageStaff")}
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
            {loading ? t("common.loading") : t("site.empty")}
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
          description={t("site.importHelp")}
          onDone={(r) =>
            done(t("site.imported", { linked: r.linked, existing: r.already_linked }))
          }
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
function Users({ notify }) {
  useI18n();
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
      notify(t("users.created"));
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
      notify(t("users.grantSaved"));
    } catch (e) {
      setError(e);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("users.eyebrow")}</p>
          <h1>{t("users.title")}</h1>
          <p className="muted">{t("users.intro")}</p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setForm(true);
          }}
        >
          {t("users.add")}
        </button>
      </div>
      <ErrorNotice error={listError ?? siteError} />
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.email")}</th>
              <th>{t("users.role")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role === "admin" ? t("common.admin") : t("common.siteManager")}</td>
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
                      {t("users.grantSites")}
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
        <Modal title={t("users.createTitle")} onClose={() => setForm(false)}>
          <ErrorNotice error={error} />
          <form onSubmit={submit}>
            {[
              [t("common.name"), "name", "text"],
              [t("common.email"), "email", "email"],
              [t("common.password"), "password", "password"],
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
            <p className="muted">{t("users.passwordHint")}</p>
            <Field
              label={t("users.role")}
              value={value.role}
              onChange={(v) => setValue((x) => ({ ...x, role: v }))}
              options={[
                ["site_manager", t("common.siteManager")],
                ["admin", t("common.admin")],
              ]}
            />
            <div className="form-actions">
              <button>{t("users.create")}</button>
            </div>
          </form>
        </Modal>
      )}
      {assignment && (
        <Modal
          title={t("users.grantTitle", { name: assignment.name })}
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
                      notify(t("users.grantRevoked"));
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  {t("users.revoke")}
                </button>
              </div>
            ))}
          </div>
          <form onSubmit={assign}>
            <Field
              label={t("users.site")}
              value={site}
              onChange={setSite}
              options={sites.items.map((s) => [s.id, s.name])}
            />
            <div className="form-actions">
              <button disabled={!site}>{t("users.saveGrant")}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Audit() {
  useI18n();
  const [page, setPage] = useState(1);
  const { data, error } = useList(`/audit?page=${page}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("audit.eyebrow")}</p>
          <h1>{t("audit.title")}</h1>
          <p className="muted">{t("audit.intro")}</p>
        </div>
      </div>
      <ErrorNotice error={error} />
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("audit.time")}</th>
              <th>{t("audit.action")}</th>
              <th>{t("audit.entity")}</th>
              <th>{t("audit.actor")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td>{formatDate(a.at)}</td>
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
  useI18n();
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
  if (loading) return <main className="loading">{t("common.loading")}</main>;
  if (!user)
    return (
      <main className="login-layout">
        <section className="login-intro">
          <span className="brand-mark">W</span>
          <p className="eyebrow">{t("login.eyebrow")}</p>
          <h1>
            {t("login.headline1")}
            <br />
            {t("login.headline2")}
          </h1>
          <p>{t("login.intro")}</p>
        </section>
        <section className="login-card">
          <p className="eyebrow">{t("login.welcomeEyebrow")}</p>
          <h2>{t("login.title")}</h2>
          <p className="muted">{t("login.hint")}</p>
          <ErrorNotice error={error} />
          <form onSubmit={login}>
            <Field
              label={t("common.email")}
              type="email"
              value={email}
              onChange={setEmail}
              required
            />
            <Field
              label={t("common.password")}
              type="password"
              value={password}
              onChange={setPassword}
              required
            />
            <button className="full-width" disabled={busy}>
              {busy ? t("login.submitting") : t("login.submit")}
            </button>
          </form>
          <LocaleSwitch />
        </section>
      </main>
    );
  const nav = [
    ["requests", t("nav.requests")],
    ["roster", t("nav.roster")],
    ["staff", t("nav.staff")],
    ["sites", t("nav.sites")],
    ...(user.role === "admin"
      ? [
          ["users", t("nav.users")],
          ["settings", t("nav.settings")],
        ]
      : []),
    ["audit", t("nav.audit")],
  ];
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">W</span>
          <span>
            WORKFORCE<small>{t("login.tagline")}</small>
          </span>
        </div>
        <nav aria-label={t("nav.label")}>
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
          <small>{user.role === "admin" ? t("common.admin") : t("common.siteManager")}</small>
          <LocaleSwitch />
          <button className="quiet" onClick={logout}>
            {t("nav.logout")}
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="topbar">
          <span>{t("nav.workspace")}</span>
          <span aria-label={t("messaging.modeLabel")}>
            {messaging
              ? t("messaging.summary", {
                  voice: messaging.voice === "twilio" ? t("messaging.voiceReal") : t("messaging.voiceMock"),
                  whatsapp: messaging.whatsapp === "service" ? t("messaging.whatsappReal") : t("messaging.whatsappMock"),
                })
              : t("messaging.unknown")}
          </span>
          <span>
            {formatDate(new Date(), {
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
