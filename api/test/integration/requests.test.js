import { resetTestData } from '../test-db.js';
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../../src/db.js";
import { hashPassword } from "../../src/security.js";
import { createApp } from "../../src/app.js";
import { processEvent } from "../../src/messaging.js";
import { randomUUID } from "node:crypto";
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
  throw Error("Local test database required");
const pool = createPool(url.toString());
let server,
  base,
  token,
  site,
  staff = [];
let now = new Date("2026-11-02T06:00:00Z");
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
const range = {
  start_at: "2026-11-04T23:00:00Z",
  end_at: "2026-11-05T07:00:00Z",
};
async function request(extra = {}) {
  const r = await call("POST", "/api/requests", {
    site_id: site,
    ...range,
    mode: "broadcast",
    headcount: 1,
    channels: ["whatsapp", "voice"],
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function send(id) {
  const r = await call("POST", `/api/requests/${id}/send`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function reply(requestId, staffId, option = "ACCEPT") {
  const detail = (await call("GET", `/api/requests/${requestId}`)).body;
  const candidate = detail.candidates.find((x) => x.staff_id === staffId);
  assert.ok(candidate);
  const attempt =
    candidate.attempts.find((x) => x.channel === "voice") ??
    candidate.attempts[0];
  assert.ok(attempt);
  return call("POST", `/api/mock/attempts/${attempt.id}/events`, {
    type: "reply",
    option_id: option,
  });
}
before(async () => {
  await migrate(pool);
  await resetTestData(pool);
  await pool.query(
    "INSERT INTO users(email,name,password_hash,role) VALUES('request@test.local','Admin',$1,'admin')",
    [await hashPassword("Local-test-password-123")],
  );
  server = createApp({
    pool,
    clock: () => new Date(now),
    messagingMode: "mock",
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (
    await call("POST", "/api/auth/login", {
      email: "request@test.local",
      password: "Local-test-password-123",
    })
  ).body.token;
  site = (
    await call("POST", "/api/sites", {
      code: "REQUEST",
      name: "Request",
      timezone: "Asia/Singapore",
    })
  ).body.id;
  for (const [name, mobile] of [
    ["Anna", "+6591234567"],
    ["Ben", "+6591234568"],
    ["Cat", "+6591234569"],
  ])
    staff.push(
      (
        await call("POST", "/api/staff", {
          name,
          mobile,
          whatsapp_opt_in: true,
          whatsapp_opt_in_source: "paper_form",
        })
      ).body.id,
    );
  await call("POST", `/api/sites/${site}/staff`, { staff_ids: staff });
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});
test("Local dispatch acceptance", async (t) => {
  let first;
  await t.test(
    "AC-R-01-01/AC-R-02-01 creates draft and candidate snapshot",
    async () => {
      first = await request();
      assert.equal(first.status, "draft");
      assert.equal(first.candidates.length, 3);
      assert.equal(first.deadline_at, "2026-11-04T23:00:00.000Z");
    },
  );
  await t.test(
    "AC-R-03-01/02 draft candidates may be removed and restored",
    async () => {
      const candidate = first.candidates.find((c) => c.staff_id === staff[2]);
      assert.equal(
        (
          await call(
            "DELETE",
            `/api/requests/${first.id}/candidates/${candidate.id}`,
          )
        ).status,
        200,
      );
      assert.equal(
        (await call("GET", `/api/requests/${first.id}`)).body.candidates.length,
        2,
      );
      assert.equal(
        (
          await call("POST", `/api/requests/${first.id}/candidates`, {
            staff_id: staff[2],
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "AC-R-05-03 broadcast creates parallel offers for both channels",
    async () => {
      const r = await send(first.id);
      assert.equal(r.status, "open");
      assert.equal(
        r.candidates
          .flatMap((c) => c.attempts)
          .filter((a) => a.purpose === "offer").length,
        6,
      );
    },
  );
  await t.test(
    "AC-R-06-04 simultaneous accepts allocate exactly one slot",
    async () => {
      const results = await Promise.all([
        reply(first.id, staff[0]),
        reply(first.id, staff[1]),
      ]);
      assert.ok(results.every((x) => x.status === 200));
      const r = (await call("GET", `/api/requests/${first.id}`)).body;
      assert.equal(r.status, "filled");
      assert.equal(r.accepted, 1);
      assert.equal(
        r.candidates.filter((c) => c.status === "accepted").length,
        1,
      );
      assert.equal(
        r.candidates.filter((c) => c.status === "too_late").length,
        1,
      );
    },
  );
  await t.test(
    "AC-RH-02-02 reply on another channel cannot allocate twice",
    async () => {
      const r = (await call("GET", `/api/requests/${first.id}`)).body;
      const accepted = r.candidates.find((c) => c.status === "accepted");
      const a = accepted.attempts.find(
        (a) => a.channel === "whatsapp" && a.purpose === "offer",
      );
      assert.equal(
        (
          await call("POST", `/api/mock/attempts/${a.id}/events`, {
            type: "reply",
            option_id: "ACCEPT",
          })
        ).status,
        200,
      );
      assert.equal(
        (await call("GET", `/api/requests/${first.id}`)).body.accepted,
        1,
      );
    },
  );
  await t.test(
    "AC-OWN-01 request-managed shifts must be changed through the request",
    async () => {
      const shift = (
        await pool.query("SELECT * FROM shifts WHERE request_id=$1", [first.id])
      ).rows[0];
      assert.equal(
        (
          await call("PATCH", `/api/shifts/${shift.id}`, {
            start_at: "2026-11-05T00:00:00Z",
          })
        ).status,
        409,
      );
      assert.equal(
        (await call("POST", `/api/shifts/${shift.id}/cancel`, {})).status,
        409,
      );
    },
  );
  await t.test(
    "AC-R-09-06 filled cancellation cancels assignment, shift and queued confirmation",
    async () => {
      const r = await call("POST", `/api/requests/${first.id}/cancel`, {});
      assert.equal(r.status, 200);
      assert.equal(r.body.status, "cancelled");
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM shifts WHERE request_id=$1 AND status<>'cancelled'",
            [first.id],
          )
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM attempts WHERE request_id=$1 AND purpose='confirmation' AND status='queued'",
            [first.id],
          )
        ).rows[0].count,
        "0",
      );
    },
  );
  await t.test("AC-R-04-02 direct request forces one slot", async () => {
    const r = await request({
      mode: "direct",
      staff_id: staff[0],
      headcount: 3,
    });
    assert.equal(r.headcount, 1);
    assert.equal(r.candidates.length, 1);
  });
  await t.test("AC-R-06-08 decline then accept is ignored", async () => {
    const r = await request({ mode: "direct", staff_id: staff[0] });
    await send(r.id);
    await reply(r.id, staff[0], "DECLINE");
    await reply(r.id, staff[0]);
    const d = (await call("GET", `/api/requests/${r.id}`)).body;
    assert.equal(d.accepted, 0);
    assert.equal(d.candidates[0].status, "declined");
  });
  await t.test(
    "AC-R-10-05 one staff accepting overlapping requests gets only one assignment",
    async () => {
      const a = await request({ mode: "direct", staff_id: staff[0] }),
        b = await request({ mode: "direct", staff_id: staff[0] });
      await send(a.id);
      await send(b.id);
      await Promise.all([reply(a.id, staff[0]), reply(b.id, staff[0])]);
      const ar = (await call("GET", `/api/requests/${a.id}`)).body,
        br = (await call("GET", `/api/requests/${b.id}`)).body;
      assert.equal(ar.accepted + br.accepted, 1);
      const loser = ar.accepted ? br : ar;
      assert.equal(loser.candidates[0].reason, "overlapping_shift");
      await call(
        "POST",
        `/api/requests/${ar.accepted ? a.id : b.id}/cancel`,
        {},
      );
    },
  );
  await t.test(
    "AC-RO-06-06/08 fills oldest open shift and restores it on cancel",
    async () => {
      const shift = (
        await call("POST", "/api/shifts", { site_id: site, ...range })
      ).body;
      const r = await request({ open_shift_ids: [shift.id] });
      await send(r.id);
      await reply(r.id, staff[1]);
      assert.equal(
        (
          await pool.query("SELECT staff_id FROM shifts WHERE id=$1", [
            shift.id,
          ])
        ).rows[0].staff_id,
        staff[1],
      );
      await call("POST", `/api/requests/${r.id}/cancel`, {});
      const restored = (
        await pool.query("SELECT staff_id,status FROM shifts WHERE id=$1", [
          shift.id,
        ])
      ).rows[0];
      assert.equal(restored.staff_id, null);
      assert.equal(restored.status, "draft");
    },
  );
  await t.test(
    "AC-D-05-04 manual confirmation reports overlapping shift as an error",
    async () => {
      const a = await request({ mode: "direct", staff_id: staff[0] }),
        b = await request({ mode: "direct", staff_id: staff[0] });
      await send(a.id);
      const detail = await send(b.id);
      await reply(a.id, staff[0]);
      const r = await call(
        "POST",
        `/api/requests/${b.id}/candidates/${detail.candidates[0].id}/confirm`,
        {},
      );
      assert.equal(r.status, 409);
      assert.equal(r.body.reason, "overlapping_shift");
      await call("POST", `/api/requests/${a.id}/cancel`, {});
      await call("POST", `/api/requests/${b.id}/cancel`, {});
    },
  );
  await t.test(
    "Review regression queued confirmation is cancelled when manager removes assignment",
    async () => {
      const r = await request({ mode: "direct", staff_id: staff[1] });
      await send(r.id);
      await reply(r.id, staff[1]);
      const detail = (await call("GET", `/api/requests/${r.id}`)).body;
      try {
        assert.equal(
          (
            await call(
              "POST",
              `/api/requests/${r.id}/candidates/${detail.candidates[0].id}/remove`,
              {},
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM attempts WHERE request_id=$1 AND purpose='confirmation' AND status='queued'",
              [r.id],
            )
          ).rows[0].count,
          "0",
        );
      } finally {
        await call("POST", `/api/requests/${r.id}/cancel`, {});
      }
    },
  );
  await t.test(
    "Review regression send revalidates draft open shift times",
    async () => {
      const shift = (
        await call("POST", "/api/shifts", { site_id: site, ...range })
      ).body;
      const r = await request({ open_shift_ids: [shift.id] });
      await call("PATCH", `/api/shifts/${shift.id}`, {
        start_at: "2026-11-05T00:00:00Z",
      });
      try {
        assert.equal(
          (await call("POST", `/api/requests/${r.id}/send`, {})).status,
          409,
        );
      } finally {
        await call("POST", `/api/requests/${r.id}/cancel`, {});
      }
    },
  );
  await t.test(
    "Review regression overdue queued offers are never sent after worker downtime",
    async () => {
      const before = now;
      const r = await request({
        mode: "direct",
        staff_id: staff[1],
        deadline_at: "2026-11-02T07:00:00Z",
      });
      await send(r.id);
      try {
        now = new Date("2026-11-02T07:05:00Z");
        await call("POST", "/api/mock/run-jobs", {});
        const attempt = (
          await pool.query(
            "SELECT * FROM attempts WHERE request_id=$1 AND purpose='offer' LIMIT 1",
            [r.id],
          )
        ).rows[0];
        assert.equal(attempt.status, "cancelled");
        assert.equal(attempt.external_id, null);
      } finally {
        now = before;
      }
    },
  );
  await t.test(
    "Review regression callback race cannot overwrite replied with stale delivery or failure",
    async () => {
      for (const type of ["delivered", "failed"]) {
        const r = await request({ mode: "direct", staff_id: staff[2] });
        const detail = await send(r.id);
        const attempt = detail.candidates[0].attempts.find(
          (a) => a.channel === "whatsapp",
        );
        await pool.query("UPDATE attempts SET status='sent' WHERE id=$1", [
          attempt.id,
        ]);
        const ids = [randomUUID(), randomUUID()];
        for (const [i, id] of ids.entries())
          await pool.query(
            "INSERT INTO message_events(event_id,correlation_id,payload,received_at) VALUES($1,$2,$3,$4)",
            [
              id,
              attempt.id,
              {
                event_id: id,
                correlation_id: attempt.id,
                type: i ? type : "reply",
                option_id: i ? null : "ACCEPT",
              },
              now,
            ],
          );
        const guard = await pool.connect();
        let a, b;
        try {
          await guard.query("BEGIN");
          await guard.query("SELECT id FROM requests WHERE id=$1 FOR UPDATE", [
            r.id,
          ]);
          const blocked = async (count) => {
            for (let i = 0; i < 100; i++) {
              const n = Number(
                (
                  await pool.query(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM requests WHERE id=%FOR UPDATE'",
                  )
                ).rows[0].count,
              );
              if (n >= count) return;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw Error("Callback did not reach request lock barrier");
          };
          a = processEvent(pool, () => now, ids[0]);
          await blocked(1);
          b = processEvent(pool, () => now, ids[1]);
          await blocked(2);
        } finally {
          await guard.query("COMMIT");
          guard.release();
        }
        await Promise.all([a, b]);
        try {
          assert.equal(
            (
              await pool.query("SELECT status FROM attempts WHERE id=$1", [
                attempt.id,
              ])
            ).rows[0].status,
            "replied",
          );
        } finally {
          await call("POST", `/api/requests/${r.id}/cancel`, {});
        }
      }
    },
  );
  await t.test(
    "AC-SI-01-06/AC-SI-02-03 site edits cannot invalidate open work",
    async () => {
      const r = await request({ mode: "direct", staff_id: staff[1] });
      await send(r.id);
      try {
        assert.equal(
          (await call("PATCH", `/api/sites/${site}`, { status: "inactive" }))
            .status,
          409,
        );
        assert.equal(
          (
            await call("PATCH", `/api/sites/${site}`, {
              timezone: "Australia/Sydney",
            })
          ).status,
          409,
        );
      } finally {
        await call("POST", `/api/requests/${r.id}/cancel`, {});
        await call("PATCH", `/api/sites/${site}`, {
          status: "active",
          timezone: "Asia/Singapore",
        });
      }
    },
  );
  await t.test(
    "AC-R-08-02/03 deadline keeps assignments and rejects late accepts",
    async () => {
      const r = await request({
        headcount: 2,
        deadline_at: "2026-11-02T07:00:00Z",
      });
      await send(r.id);
      await reply(r.id, staff[0]);
      now = new Date("2026-11-02T07:01:00Z");
      await call("POST", "/api/mock/run-jobs", {});
      const d = (await call("GET", `/api/requests/${r.id}`)).body;
      assert.equal(d.status, "expired");
      assert.equal(d.accepted, 1);
      await reply(r.id, staff[1]);
      assert.equal(
        (await call("GET", `/api/requests/${r.id}`)).body.candidates.find(
          (c) => c.staff_id === staff[1],
        ).status,
        "too_late",
      );
    },
  );
});
