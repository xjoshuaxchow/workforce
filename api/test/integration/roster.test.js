import { resetTestData } from '../test-db.js';
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../../src/db.js";
import { hashPassword } from "../../src/security.js";
import { createApp } from "../../src/app.js";
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Tests require local *_test database");
const pool = createPool(url.toString());
let server, base, token, site, staff;
let now = new Date("2026-11-02T06:00:00Z");
const clock = () => new Date(now);
async function call(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}
before(async () => {
  await migrate(pool);
  await resetTestData(pool);
  await pool.query(
    "INSERT INTO users(email,name,password_hash,role) VALUES('roster@test.local','Admin',$1,'admin')",
    [await hashPassword("Local-test-password-123")],
  );
  server = createApp({ pool, clock }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (
    await call("POST", "/api/auth/login", {
      email: "roster@test.local",
      password: "Local-test-password-123",
    })
  ).body.token;
  site = (
    await call("POST", "/api/sites", {
      code: "ROSTER",
      name: "Roster",
      timezone: "Asia/Singapore",
    })
  ).body.id;
  staff = (
    await call("POST", "/api/staff", {
      name: "Roster Anna",
      mobile: "+6591234567",
    })
  ).body.id;
  await call("POST", `/api/sites/${site}/staff`, { staff_ids: [staff] });
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});
test("Roster API acceptance", async (t) => {
  let shift, open;
  const range = {
    start_at: "2026-11-03T23:00:00Z",
    end_at: "2026-11-04T07:00:00Z",
  };
  await t.test("AC-RO-03-01/02 creates draft and open shifts", async () => {
    const a = await call("POST", "/api/shifts", {
      site_id: site,
      staff_id: staff,
      ...range,
    });
    assert.equal(a.status, 201);
    assert.equal(a.body.status, "draft");
    shift = a.body.id;
    const b = await call("POST", "/api/shifts", { site_id: site, ...range });
    assert.equal(b.status, 201);
    assert.equal(b.body.staff_id, null);
    open = b.body.id;
  });
  await t.test("AC-RO-16-01 overlap is rejected with reason", async () => {
    const r = await call("POST", "/api/shifts", {
      site_id: site,
      staff_id: staff,
      ...range,
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.reason, "overlapping_shift");
  });
  await t.test(
    "AC-RO-16-05 editing a shift does not conflict with itself",
    async () =>
      assert.equal(
        (await call("PATCH", `/api/shifts/${shift}`, { notes: "Bring PPE" }))
          .status,
        200,
      ),
  );
  await t.test(
    "AC-RO-10-01/04 site roster has open group and range limit",
    async () => {
      const r = await call(
        "GET",
        `/api/sites/${site}/roster?from=2026-11-03T00:00:00Z&to=2026-11-10T00:00:00Z`,
      );
      assert.equal(r.status, 200);
      assert.ok(
        r.body.groups.some(
          (g) => g.staff_id === null && g.shifts.some((s) => s.id === open),
        ),
      );
      assert.equal(
        (
          await call(
            "GET",
            `/api/sites/${site}/roster?from=2026-11-01T00:00:00Z&to=2026-12-03T00:00:00Z`,
          )
        ).status,
        400,
      );
    },
  );
  await t.test(
    "AC-S-01-09 deactivation warns but keeps future shift",
    async () => {
      const r = await call("PATCH", `/api/staff/${staff}`, {
        status: "inactive",
      });
      assert.equal(r.status, 200);
      assert.ok(
        r.body.warnings.some((w) => w.shifts.some((s) => s.id === shift)),
      );
      await call("PATCH", `/api/staff/${staff}`, { status: "active" });
    },
  );
  await t.test(
    "AC-RO-17-01/02 warning needs explicit acknowledgement",
    async () => {
      const b = (
        await call("POST", "/api/staff", {
          name: "Not linked",
          mobile: "+6591234568",
        })
      ).body.id;
      const a = await call("POST", "/api/shifts", {
        site_id: site,
        staff_id: b,
        ...range,
      });
      assert.equal(a.status, 409);
      assert.ok(a.body.warnings.includes("not_linked"));
      assert.equal(
        (
          await call("POST", "/api/shifts", {
            site_id: site,
            staff_id: b,
            ...range,
            acknowledge_warnings: true,
          })
        ).status,
        201,
      );
    },
  );
  await t.test(
    "AC-RO-16-04 real simultaneous assignments permit only one overlapping shift",
    async () => {
      const later = {
        start_at: "2026-11-06T23:00:00Z",
        end_at: "2026-11-07T07:00:00Z",
      };
      const results = await Promise.all([
        call("POST", "/api/shifts", {
          site_id: site,
          staff_id: staff,
          ...later,
        }),
        call("POST", "/api/shifts", {
          site_id: site,
          staff_id: staff,
          ...later,
        }),
      ]);
      assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
    },
  );
  await t.test("AC-RO-03-05/AC-RO-16-03 cancellation frees time", async () => {
    assert.equal(
      (await call("POST", `/api/shifts/${shift}/cancel`, {})).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/shifts", {
          site_id: site,
          staff_id: staff,
          ...range,
        })
      ).status,
      201,
    );
  });
  await t.test(
    "AC-RO-21-01/02/03 publish groups notices and repeat publish sends none",
    async () => {
      const r = await call("POST", `/api/sites/${site}/roster/publish`, {
        from: "2026-11-03T00:00:00Z",
        to: "2026-11-10T00:00:00Z",
      });
      assert.equal(r.status, 200);
      assert.ok(r.body.published >= 3);
      assert.equal(r.body.notified, 0);
      assert.ok(r.body.not_notified.includes(staff));
      const again = await call("POST", `/api/sites/${site}/roster/publish`, {
        from: "2026-11-03T00:00:00Z",
        to: "2026-11-10T00:00:00Z",
      });
      assert.equal(again.body.published, 0);
      assert.equal(again.body.notified, 0);
    },
  );
  await t.test(
    "AC-RO-22-01/04 future published shift time changes notify, notes do not",
    async () => {
      await call("PATCH", `/api/staff/${staff}`, {
        whatsapp_opt_in: true,
        whatsapp_opt_in_source: "paper_form",
      });
      const before = Number(
        (
          await pool.query(
            "SELECT count(*) FROM attempts WHERE purpose='roster_change'",
          )
        ).rows[0].count,
      );
      const r = await call("PATCH", `/api/shifts/${open}`, {
        staff_id: staff,
        start_at: "2026-11-08T23:00:00Z",
        end_at: "2026-11-09T07:00:00Z",
      });
      assert.equal(r.status, 200);
      const after = Number(
        (
          await pool.query(
            "SELECT count(*) FROM attempts WHERE purpose='roster_change'",
          )
        ).rows[0].count,
      );
      assert.equal(after, before + 1);
      await call("PATCH", `/api/shifts/${open}`, { notes: "Notes only" });
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM attempts WHERE purpose='roster_change'",
            )
          ).rows[0].count,
        ),
        after,
      );
    },
  );
});
