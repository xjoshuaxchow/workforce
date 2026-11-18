import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogs, getLocale, hasMessage, setLocale, t } from "../src/i18n.js";

const markers = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

test("Chinese is the default and English is a complete translation", () => {
  setLocale("zh-Hant");
  assert.equal(getLocale(), "zh-Hant");
  assert.equal(t("common.save"), "儲存");
  assert.equal(t("staff.imported", { count: 3 }), "已匯入 3 位員工");

  setLocale("en");
  assert.equal(t("nav.staff"), "Staff");
  assert.equal(t("login.title"), "Sign in");
  assert.equal(t("staff.imported", { count: 3 }), "Imported 3 staff");
  const previous = catalogs.en["nav.staff"];
  catalogs.en["nav.staff"] = "";
  try {
    assert.equal(t("nav.staff"), "員工管理");
  } finally {
    catalogs.en["nav.staff"] = previous;
    setLocale("zh-Hant");
  }

  for (const key of Object.keys(catalogs["zh-Hant"])) {
    const zhHant = catalogs["zh-Hant"][key];
    const en = catalogs.en[key];
    assert.equal(typeof zhHant, "string", key);
    assert.ok(zhHant.length > 0, key);
    assert.equal(typeof en, "string", key);
    assert.ok(en.length > 0, key);
    assert.equal(hasMessage(key), true);
    assert.deepEqual(markers(en), markers(zhHant), key);
  }
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs["zh-Hant"]).sort());
});
