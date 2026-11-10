import { HONG_KONG_TIMEZONE } from "./time.js";
import React, { useEffect, useState } from "react";
import { api, loadAllPages } from "./api.js";
export function ErrorNotice({ error }) {
  return error ? (
    <div role="alert" className="notice error">
      <strong>{error.message}</strong>
      {error.errors?.length > 0 && (
        <ul>
          {error.errors.map((x, i) => (
            <li key={i}>
              {x.row ? `第 ${x.row} 行 · ` : ""}
              {x.field}：{x.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;
}
export function mutationNotice(message, warnings = []) {
  const shifts = warnings.flatMap((w) => w.shifts ?? []);
  if (!shifts.length) return message;
  return (
    <>
      <strong>{message}。請注意，以下未來班次仍然保留：</strong>
      <ul>
        {shifts.map((s) => (
          <li key={s.id}>
            {s.site_name ?? "工作地點"} ·{" "}
            {new Intl.DateTimeFormat("zh-HK", {
              timeZone: HONG_KONG_TIMEZONE,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(s.start_at))}{" "}
            至{" "}
            {new Intl.DateTimeFormat("zh-HK", {
              timeZone: HONG_KONG_TIMEZONE,
              timeStyle: "short",
            }).format(new Date(s.end_at))}
          </li>
        ))}
      </ul>
    </>
  );
}
export function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  disabled = false,
  options,
  children,
}) {
  if (options)
    return (
      <PagedSelect
        label={label}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        options={options}
      />
    );
  return (
    <label className="field">
      <span>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {options ? (
        <select
          disabled={disabled}
          aria-label={label}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map(([id, text]) => (
            <option key={id} value={id}>
              {text}
            </option>
          ))}
        </select>
      ) : (
        (children ?? (
          <input
            disabled={disabled}
            aria-label={label}
            name={name}
            type={type}
            required={required}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        ))
      )}
    </label>
  );
}
export function PagedSelect({
  label,
  name,
  value,
  onChange,
  required = false,
  disabled = false,
  options,
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const filtered = options.filter(([, text]) =>
    String(text)
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50)),
    current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * 50, current * 50);
  const selected = options.find(([id]) => id === value);
  const searchable = options.length > 50 || search.length > 0;
  const rendered =
    selected && !visible.some(([id]) => id === value)
      ? [selected, ...visible]
      : visible;
  return (
    <div className="field">
      <span>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {searchable && (
        <input
          aria-label={`搜尋${label}`}
          placeholder="搜尋名稱或號碼"
          value={search}
          disabled={disabled}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      )}
      <select
        aria-label={label}
        name={name}
        value={value ?? ""}
        disabled={disabled}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      >
        {rendered.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      {searchable && (
        <div className="picker-controls">
          <button
            type="button"
            className="quiet"
            aria-label={`${label}上一頁`}
            disabled={disabled || current === 1}
            onClick={() => setPage(current - 1)}
          >
            上一頁
          </button>
          <span className="muted">
            {filtered.length} 筆 · {current} / {pages}
          </span>
          <button
            type="button"
            className="quiet"
            aria-label={`${label}下一頁`}
            disabled={disabled || current === pages}
            onClick={() => setPage(current + 1)}
          >
            下一頁
          </button>
        </div>
      )}
    </div>
  );
}

export function PagedItems({ label, items, children }) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const filtered = items.filter((s) =>
    `${s.name} ${s.mobile ?? ""}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50)),
    current = Math.min(page, pages);
  return (
    <>
      <input
        aria-label={`搜尋${label}`}
        placeholder="搜尋姓名或手機號碼"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <div className="check-list">
        {filtered.slice((current - 1) * 50, current * 50).map(children)}
      </div>
      <div className="picker-controls">
        <button
          type="button"
          className="quiet"
          aria-label={`${label}上一頁`}
          disabled={current === 1}
          onClick={() => setPage(current - 1)}
        >
          上一頁
        </button>
        <span className="muted">
          {filtered.length} 筆 · {current} / {pages}
        </span>
        <button
          type="button"
          className="quiet"
          aria-label={`${label}下一頁`}
          disabled={current === pages}
          onClick={() => setPage(current + 1)}
        >
          下一頁
        </button>
      </div>
    </>
  );
}
export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="overlay">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="quiet" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Pager({ data, page, onChange }) {
  return (
    <footer className="pager">
      <span>共 {data.total ?? 0} 筆</span>
      <button
        className="quiet"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        上一頁
      </button>
      <span>第 {page} 頁</span>
      <button
        className="quiet"
        disabled={page * 50 >= (data.total ?? 0)}
        onClick={() => onChange(page + 1)}
      >
        下一頁
      </button>
    </footer>
  );
}
export function useList(path, version = 0, load = api) {
  const [data, setData] = useState({ items: [], total: 0 }),
    [error, setError] = useState(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    load(path)
      .then((x) => {
        if (active) {
          setData({ ...x, sourcePath: path });
          setError(null);
        }
      })
      .catch((e) => active && setError(e))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [path, version, load]);
  const current = data.sourcePath === path;
  return {
    data: current ? data : { items: [], total: 0 },
    error,
    loading: loading || !current,
  };
}
export const useAllList = (path, version = 0) =>
  useList(path, version, loadAllPages);
