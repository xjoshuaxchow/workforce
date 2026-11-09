import { resetTestData } from '../test-db.js';
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../../src/db.js";
import { hashPassword } from "../../src/security.js";
import { createApp } from "../../src/app.js";
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Only local dedicated test database is allowed");
const pool = createPool(url.toString());
let server, base, token, managerToken, manager, site, staff;
const clock = () => new Date("2026-11-02T06:00:00Z");
async function call(method, path, body, auth = token) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
before(async () => {
  await migrate(pool);
  await resetTestData(pool);
  const hash = await hashPassword("Local-test-password-123");
  await pool.query(
    "INSERT INTO users(email,name,password_hash,role) VALUES('admin@test.local','Admin',$1,'admin')",
    [hash],
  );
  server = createApp({ pool, clock, origin: "http://127.0.0.1:5210" }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});
test("Foundation API acceptance", async (t) => {
  await t.test("AC-U-01-01 login is case insensitive", async () => {
    const r = await call(
      "POST",
      "/api/auth/login",
      { email: "ADMIN@test.local", password: "Local-test-password-123" },
      null,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, "admin");
    token = r.body.token;
    assert.ok(token);
  });
  await t.test(
    "AC-U-01-02/03 generic login failure hides account existence",
    async () => {
      const a = await call(
        "POST",
        "/api/auth/login",
        { email: "admin@test.local", password: "wrong" },
        null,
      );
      const b = await call(
        "POST",
        "/api/auth/login",
        { email: "missing@test.local", password: "wrong" },
        null,
      );
      assert.equal(a.status, 401);
      assert.deepEqual(a, b);
    },
  );
  await t.test("AC-U-01-05 unauthenticated access fails", async () =>
    assert.equal(
      (await call("GET", "/api/staff", undefined, null)).status,
      401,
    ),
  );
  await t.test("AC-U-02-01/02 rejects missing and unknown role", async () => {
    for (const role of [undefined, "superuser"])
      assert.equal(
        (
          await call("POST", "/api/users", {
            email: "m@test.local",
            name: "M",
            password: "Local-test-password-123",
            role,
          })
        ).status,
        400,
      );
  });
  await t.test(
    "AC-U-01-06 creates user with a hash and manager role",
    async () => {
      const r = await call("POST", "/api/users", {
        email: "manager@test.local",
        name: "Manager",
        password: "Local-test-password-123",
        role: "site_manager",
      });
      assert.equal(r.status, 201);
      manager = r.body.id;
      assert.equal(r.body.password_hash, undefined);
      const { rows } = await pool.query(
        "SELECT password_hash FROM users WHERE id=$1",
        [manager],
      );
      assert.notEqual(rows[0].password_hash, "Local-test-password-123");
      managerToken = (
        await call(
          "POST",
          "/api/auth/login",
          { email: "manager@test.local", password: "Local-test-password-123" },
          null,
        )
      ).body.token;
    },
  );
  await t.test(
    "AC-SI-01-01 creates active site and ignores client record times",
    async () => {
      const r = await call("POST", "/api/sites", {
        code: "north",
        name: "North",
        timezone: "Asia/Singapore",
        ctime: "2000-01-01T00:00:00Z",
      });
      assert.equal(r.status, 201);
      site = r.body.id;
      assert.equal(r.body.status, "active");
      assert.equal(r.body.ctime, clock().toISOString());
    },
  );
  await t.test(
    "AC-SI-01-02 normalized duplicate site code conflicts",
    async () =>
      assert.equal(
        (
          await call("POST", "/api/sites", {
            code: "NORTH",
            name: "Other",
            timezone: "Asia/Singapore",
          })
        ).status,
        409,
      ),
  );
  await t.test(
    "AC-U-03-01/02 manager-site assignment is idempotent",
    async () => {
      for (let i = 0; i < 2; i++)
        assert.equal(
          (await call("POST", `/api/users/${manager}/sites`, { site_id: site }))
            .status,
          200,
        );
      const rows = await pool.query("SELECT * FROM site_managers");
      assert.equal(rows.rowCount, 1);
    },
  );
  await t.test("AC-U-03-04 manager cannot self-assign", async () =>
    assert.equal(
      (
        await call(
          "POST",
          `/api/users/${manager}/sites`,
          { site_id: site },
          managerToken,
        )
      ).status,
      403,
    ),
  );
  await t.test("AC-S-01-01 creates staff defaults", async () => {
    const r = await call("POST", "/api/staff", {
      name: " Anna ",
      mobile: "+65 9123-4567",
    });
    assert.equal(r.status, 201);
    staff = r.body.id;
    assert.equal(r.body.name, "Anna");
    assert.equal(r.body.mobile, "+6591234567");
    assert.equal(r.body.whatsapp_opt_in, false);
  });
  await t.test("AC-S-01-04 duplicate normalized mobile conflicts", async () =>
    assert.equal(
      (
        await call("POST", "/api/staff", {
          name: "Other",
          mobile: "+6591234567",
        })
      ).status,
      409,
    ),
  );
  await t.test("AC-S-01-08 manager cannot change global staff", async () =>
    assert.equal(
      (
        await call(
          "POST",
          "/api/staff",
          { name: "Other", mobile: "+6591234568" },
          managerToken,
        )
      ).status,
      403,
    ),
  );
  await t.test("AC-U-05-02 unlinked staff existence is hidden", async () =>
    assert.equal(
      (await call("GET", `/api/staff/${staff}`, undefined, managerToken))
        .status,
      404,
    ),
  );
  await t.test(
    "AC-L-01-01/02 link is idempotent and staff becomes visible",
    async () => {
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await call("POST", `/api/sites/${site}/staff`, {
              staff_ids: [staff],
            })
          ).status,
          200,
        );
      assert.equal(
        (await call("GET", `/api/staff/${staff}`, undefined, managerToken))
          .status,
        200,
      );
    },
  );
  await t.test(
    "AC-S-04-01 opt-in writes source and injected time",
    async () => {
      const r = await call("PATCH", `/api/staff/${staff}`, {
        whatsapp_opt_in: true,
        whatsapp_opt_in_source: "paper_form",
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.whatsapp_opt_in_at, clock().toISOString());
    },
  );
  await t.test(
    "AC-S-06-01/02/05/06 name and number search are paginated",
    async () => {
      for (const search of ["anna", "9123"]) {
        const r = await call("GET", `/api/staff?search=${search}`);
        assert.equal(r.status, 200);
        assert.equal(r.body.total, 1);
        assert.equal(r.body.items[0].id, staff);
        assert.equal(r.body.limit, 50);
      }
    },
  );
  await t.test(
    "AC-S-05-01/06/08 imports CSV with defaults and unknown columns",
    async () => {
      const r = await call("POST", "/api/staff/import", {
        csv: "name,mobile,whatsapp_opt_in,extra\nBen,+6591234568,true,ignored\nCat,+6591234569,false,ignored",
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.created, 2);
      const { rows } = await pool.query("SELECT * FROM staff WHERE name='Ben'");
      assert.equal(rows[0].whatsapp_opt_in_source, "import");
    },
  );
  await t.test(
    "AC-S-05-02/03/04/05 invalid CSV never partially writes",
    async () => {
      for (const csv of [
        "name,mobile\nNew,+6591234570\nBad,hello",
        "name,mobile\nNew,+6591234570\nAgain,+65 9123-4570",
        "name,mobile\nNew,+6591234570\nExisting,+6591234567",
        "name\nNo mobile",
      ]) {
        const before = Number(
          (await pool.query("SELECT count(*) FROM staff")).rows[0].count,
        );
        const r = await call("POST", "/api/staff/import", { csv });
        assert.equal(r.status, 400);
        assert.ok(r.body.errors.length);
        assert.equal(
          Number(
            (await pool.query("SELECT count(*) FROM staff")).rows[0].count,
          ),
          before,
        );
      }
    },
  );
  await t.test("AC-S-05-09 manager cannot import staff", async () =>
    assert.equal(
      (
        await call(
          "POST",
          "/api/staff/import",
          { csv: "name,mobile\nNew,+6591234570" },
          managerToken,
        )
      ).status,
      403,
    ),
  );
  await t.test("AC-L-02-02 lists linked sites of staff", async () => {
    const r = await call("GET", `/api/staff/${staff}/sites`);
    assert.equal(r.status, 200);
    assert.equal(r.body.items[0].id, site);
  });
  await t.test(
    "AC-L-03-01/04 bulk CSV linkage counts existing links",
    async () => {
      const r = await call("POST", "/api/links/import", {
        csv: "site_code,staff_mobile\nNORTH,+6591234567\nNORTH,+6591234568",
      });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { linked: 1, already_linked: 1 });
    },
  );
  await t.test(
    "AC-L-03-02/03 bulk linkage invalid row rolls everything back",
    async () => {
      const before = (await pool.query("SELECT count(*) FROM site_staff"))
        .rows[0].count;
      const r = await call("POST", "/api/links/import", {
        csv: "site_code,staff_mobile\nNORTH,+6591234569\nUNKNOWN,+6591234567",
      });
      assert.equal(r.status, 400);
      assert.equal(
        (await pool.query("SELECT count(*) FROM site_staff")).rows[0].count,
        before,
      );
    },
  );
  await t.test(
    "AC-SI-01-04 admin updates and soft-deactivates site",
    async () => {
      const r = await call("PATCH", `/api/sites/${site}`, {
        address: "North road",
        status: "inactive",
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.status, "inactive");
      assert.equal(
        (await call("POST", `/api/sites/${site}/staff`, { staff_ids: [staff] }))
          .status,
        409,
      );
      await call("PATCH", `/api/sites/${site}`, { status: "active" });
    },
  );
  await t.test(
    "AC-N-01-01/04 audit records persist with business data",
    async () => {
      const r = await call("GET", "/api/audit");
      assert.equal(r.status, 200);
      assert.ok(
        r.body.items.some(
          (x) => x.entity_id === staff && x.action === "staff.updated",
        ),
      );
      const before = (await pool.query("SELECT count(*) FROM audit_log"))
        .rows[0].count;
      await call("POST", "/api/staff", {
        name: "duplicate",
        mobile: "+6591234567",
      });
      assert.equal(
        (await pool.query("SELECT count(*) FROM audit_log")).rows[0].count,
        before,
      );
    },
  );
  await t.test(
    "AC-L-01-03/04/AC-U-05-04 unlink hides staff and reuses linkage on relink",
    async () => {
      const before = (
        await pool.query("SELECT id FROM site_staff WHERE staff_id=$1", [staff])
      ).rows[0].id;
      assert.equal(
        (await call("DELETE", `/api/sites/${site}/staff/${staff}`)).status,
        200,
      );
      assert.equal(
        (await call("GET", `/api/staff/${staff}`, undefined, managerToken))
          .status,
        404,
      );
      await call("POST", `/api/sites/${site}/staff`, { staff_ids: [staff] });
      assert.equal(
        (
          await pool.query("SELECT id FROM site_staff WHERE staff_id=$1", [
            staff,
          ])
        ).rows[0].id,
        before,
      );
    },
  );
  await t.test("AC-U-01-07 logout revokes token", async () => {
    assert.equal(
      (await call("POST", "/api/auth/logout", {}, managerToken)).status,
      200,
    );
    assert.equal(
      (await call("GET", "/api/sites", undefined, managerToken)).status,
      401,
    );
  });
  await t.test(
    "AC-U-03-03/AC-U-04-05 revoked site grant takes effect immediately",
    async () => {
      managerToken = (
        await call(
          "POST",
          "/api/auth/login",
          { email: "manager@test.local", password: "Local-test-password-123" },
          null,
        )
      ).body.token;
      assert.equal(
        (await call("DELETE", `/api/users/${manager}/sites/${site}`)).status,
        200,
      );
      assert.equal(
        (await call("GET", "/api/sites", undefined, managerToken)).body.total,
        0,
      );
      assert.equal(
        (await call("GET", `/api/staff/${staff}`, undefined, managerToken))
          .status,
        404,
      );
    },
  );
});
