import express from "express";
import helmet from "helmet";
import cors from "cors";
import { z } from "zod";
import {
  validateStaff,
  validateSite,
  pagination,
  fail,
  validation,
  AppError,
} from "./domain.js";
import {
  hashPassword,
  verifyPassword,
  newToken,
  tokenHash,
} from "./security.js";
import { mutate, audit, admin, siteAccess, staffAccess } from "./service.js";
import { registerManagement } from "./management.js";
import { registerRoster, futureStaffWarnings } from "./roster.js";
import { registerDispatch } from "./dispatch.js";
import { channelRequestContext } from "./channel-context.js";
import { registerMessaging } from "./messaging.js";

const userFields = "id,email,name,role,active,ctime,utime";
const dummyHash = `scrypt:00000000000000000000000000000000:${"00".repeat(64)}`;
export function createApp({
  pool,
  clock = () => new Date(),
  origin = "http://127.0.0.1:5210",
  messagingMode = "mock",
  messagingSecret = process.env.MESSAGING_SECRET,
  pstn = null,
  settings = null,
  runtime = null,
  whatsappMode = "mock",
} = {}) {
  const effectiveMode =
    whatsappMode === "service"
      ? messagingMode + "+whatsapp-service"
      : messagingMode;
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => channelRequestContext.run({}, next));
  app.use(async (req, res, next) => {
    req.channelState = runtime
      ? await runtime.status()
      : {
          mode: effectiveMode,
          voice: messagingMode === "twilio-pstn" ? "twilio" : "mock",
          whatsapp: whatsappMode,
        };
    next();
  });
  app.use(helmet());
  app.use(cors({ origin, credentials: true }));
  app.use(
    express.json({
      limit: "5mb",
      verify: (req, res, buffer) => {
        req.rawBody = buffer;
      },
    }),
  );
  app.get("/health", async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "ns-workforce-api" });
  });
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length > 1024
    )
      validation("credentials", "Email and password are required");
    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [
      email.trim().toLowerCase(),
    ]);
    const user = rows[0];
    const valid = await verifyPassword(
      password,
      user?.password_hash ?? dummyHash,
    );
    if (!valid || !user?.active) fail(401, "Invalid email or password");
    const token = newToken(),
      expires = new Date(clock().getTime() + 8 * 3600000);
    await mutate(pool, clock, async (db) => {
      const r = await db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3) RETURNING id",
        [tokenHash(token), user.id, expires],
      );
      await audit(
        db,
        clock,
        user,
        "session.created",
        "session",
        r.rows[0].id,
        null,
        { user_id: user.id },
      );
    });
    res.cookie("workforce_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 3600000,
      path: "/",
    });
    const { password_hash, ...publicUser } = user;
    res.json({ token, user: publicUser });
  });
  app.use("/api", async (req, res, next) => {
    const bearer = req.get("authorization");
    const cookie = String(req.get("cookie") ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("workforce_session="));
    const token = bearer?.startsWith("Bearer ")
      ? bearer.slice(7)
      : cookie?.slice("workforce_session=".length);
    if (!token) fail(401, "Authentication required");
    const { rows } = await pool.query(
      `SELECT u.*,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.active`,
      [tokenHash(token), clock()],
    );
    if (!rows[0]) fail(401, "Authentication required");
    req.user = rows[0];
    const observedMode = req.get("X-Workforce-Messaging-Mode");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      observedMode &&
      observedMode !== req.channelState.mode
    )
      fail(409, "傳送模式已改變，請確認頁面顯示的模式後再操作", {
        reason: "messaging_mode_changed",
      });
    const revision = req.get("X-Workforce-Settings-Revision");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      revision &&
      revision !== req.channelState.configuration_revision
    )
      fail(409, "Settings changed; refresh before retrying", {
        reason: "settings_revision_changed",
      });
    if (
      runtime &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !(
        req.method === "PATCH" &&
        req.originalUrl.split("?")[0] === "/api/settings/channels"
      )
    )
      channelRequestContext.getStore().settingsVersion =
        req.channelState.configuration_revision;
    next();
  });
  app.get("/api/auth/me", (req, res) => {
    const { password_hash, session_id, ...user } = req.user;
    res.json(user);
  });
  app.get("/api/messaging/status", (req, res) => res.json(req.channelState));
  app.post("/api/auth/logout", async (req, res) => {
    await mutate(pool, clock, async (db) => {
      const before = (
        await db.query(
          "DELETE FROM sessions WHERE id=$1 RETURNING id,user_id",
          [req.user.session_id],
        )
      ).rows[0];
      if (before)
        await audit(
          db,
          clock,
          req.user,
          "session.revoked",
          "session",
          before.id,
          before,
          null,
        );
    });
    res.clearCookie("workforce_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/users", async (req, res) => {
    admin(req.user);
    const { page, limit, offset } = pagination(req.query);
    const rows = await pool.query(
      `SELECT ${userFields} FROM users ORDER BY ctime,id LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    res.json({
      items: rows.rows,
      total: Number(
        (await pool.query("SELECT count(*) FROM users")).rows[0].count,
      ),
      page,
      limit,
    });
  });
  app.post("/api/users", async (req, res) => {
    admin(req.user);
    const parsed = z
      .object({
        email: z.email().transform((x) => x.toLowerCase()),
        name: z.string().trim().min(1).max(100),
        password: z.string().min(12).max(1024),
        role: z.enum(["admin", "site_manager"]),
      })
      .safeParse(req.body);
    if (!parsed.success)
      fail(400, "Validation failed", {
        errors: parsed.error.issues.map((x) => ({
          field: x.path.join("."),
          message: x.message,
        })),
      });
    const body = parsed.data,
      hash = await hashPassword(body.password);
    const result = await mutate(pool, clock, async (db) => {
      const row = (
        await db.query(
          `INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING ${userFields}`,
          [body.email, body.name, hash, body.role],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "user.created",
        "user",
        row.id,
        null,
        row,
      );
      return row;
    });
    res.status(201).json(result);
  });
  app.post("/api/users/:id/sites", async (req, res) => {
    admin(req.user);
    const result = await mutate(pool, clock, async (db) => {
      const u = (
        await db.query("SELECT id,role FROM users WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!u) fail(404, "User not found");
      if (u.role !== "site_manager")
        validation("user_id", "Site assignment only applies to site managers");
      const site = await siteAccess(db, req.user, req.body.site_id);
      const rows = await db.query(
        "INSERT INTO site_managers(site_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING *",
        [site.id, u.id],
      );
      if (rows.rowCount)
        await audit(
          db,
          clock,
          req.user,
          "site_manager.assigned",
          "site_manager",
          rows.rows[0].id,
          null,
          rows.rows[0],
          site.id,
        );
      return { ok: true };
    });
    res.json(result);
  });
  app.get("/api/sites", async (req, res) => {
    const { page, limit, offset } = pagination(req.query),
      params = [req.user.role, req.user.id];
    const where =
      "($1='admin' OR EXISTS(SELECT 1 FROM site_managers m WHERE m.site_id=s.id AND m.user_id=$2))";
    const total = Number(
      (await pool.query(`SELECT count(*) FROM sites s WHERE ${where}`, params))
        .rows[0].count,
    );
    const { rows } = await pool.query(
      `SELECT s.* FROM sites s WHERE ${where} ORDER BY s.code,s.id LIMIT $3 OFFSET $4`,
      [...params, limit, offset],
    );
    res.json({ items: rows, total, page, limit });
  });
  app.delete("/api/users/:id/sites/:siteId", async (req, res) => {
    admin(req.user);
    await mutate(pool, clock, async (db) => {
      const before = (
        await db.query(
          "DELETE FROM site_managers WHERE user_id=$1 AND site_id=$2 RETURNING *",
          [req.params.id, req.params.siteId],
        )
      ).rows[0];
      if (before)
        await audit(
          db,
          clock,
          req.user,
          "site_manager.revoked",
          "site_manager",
          before.id,
          before,
          null,
          before.site_id,
        );
    });
    res.json({ ok: true });
  });
  app.get("/api/users/:id/sites", async (req, res) => {
    admin(req.user);
    const { rows } = await pool.query(
      "SELECT s.* FROM sites s JOIN site_managers m ON m.site_id=s.id WHERE m.user_id=$1 ORDER BY s.code,s.id",
      [req.params.id],
    );
    res.json({ items: rows });
  });
  app.post("/api/sites", async (req, res) => {
    admin(req.user);
    const v = validateSite(req.body);
    const row = await mutate(pool, clock, async (db) => {
      const r = (
        await db.query(
          "INSERT INTO sites(code,name,address,timezone,status,voice_name_en,voice_address_en) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [v.code, v.name, v.address, v.timezone, v.status, v.voice_name_en, v.voice_address_en],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "site.created",
        "site",
        r.id,
        null,
        r,
        r.id,
      );
      return r;
    });
    res.status(201).json(row);
  });
  app.get("/api/staff", async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const values = [req.user.role, req.user.id];
    const conditions = [
      "($1='admin' OR EXISTS(SELECT 1 FROM site_staff l JOIN site_managers m ON l.site_id=m.site_id WHERE l.staff_id=s.id AND l.active AND m.user_id=$2))",
    ];
    const bind = (v) => {
      values.push(v);
      return `$${values.length}`;
    };
    if (req.query.status) conditions.push(`s.status=${bind(req.query.status)}`);
    else conditions.push("s.status<>'inactive'");
    if (req.query.search) {
      const q = bind(`%${req.query.search}%`);
      conditions.push(`(s.name ILIKE ${q} OR s.mobile LIKE ${q})`);
    }
    if (req.query.site) {
      const p = bind(req.query.site);
      conditions.push(
        `EXISTS(SELECT 1 FROM site_staff l WHERE l.staff_id=s.id AND l.site_id=${p} AND l.active AND ($1='admin' OR EXISTS(SELECT 1 FROM site_managers m WHERE m.site_id=l.site_id AND m.user_id=$2)))`,
      );
    }
    const where = conditions.join(" AND ");
    const total = Number(
      (await pool.query(`SELECT count(*) FROM staff s WHERE ${where}`, values))
        .rows[0].count,
    );
    const { rows } = await pool.query(
      `SELECT s.* FROM staff s WHERE ${where} ORDER BY s.name,s.id LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
      values,
    );
    res.json({ items: rows, total, page, limit });
  });
  app.get("/api/staff/:id", async (req, res) =>
    res.json(await staffAccess(pool, req.user, req.params.id)),
  );
  app.post("/api/staff", async (req, res) => {
    admin(req.user);
    const v = validateStaff(req.body);
    const row = await mutate(pool, clock, async (db) => {
      const r = (
        await db.query(
          "INSERT INTO staff(name,mobile,landline,language,preferred_channel,status,whatsapp_opt_in,whatsapp_opt_in_at,whatsapp_opt_in_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            v.name,
            v.mobile,
            v.landline,
            v.language,
            v.preferred_channel,
            v.status,
            v.whatsapp_opt_in,
            v.whatsapp_opt_in ? clock() : null,
            v.whatsapp_opt_in_source,
          ],
        )
      ).rows[0];
      await audit(db, clock, req.user, "staff.created", "staff", r.id, null, r);
      return r;
    });
    res.status(201).json(row);
  });
  app.patch("/api/staff/:id", async (req, res) => {
    admin(req.user);
    const row = await mutate(pool, clock, async (db) => {
      const before = (
        await db.query("SELECT * FROM staff WHERE id=$1 FOR UPDATE", [
          req.params.id,
        ])
      ).rows[0];
      if (!before) fail(404, "Staff not found");
      const v = validateStaff({ ...before, ...req.body });
      const r = (
        await db.query(
          "UPDATE staff SET name=$2,mobile=$3,landline=$4,language=$5,preferred_channel=$6,status=$7,whatsapp_opt_in=$8,whatsapp_opt_in_at=$9,whatsapp_opt_in_source=$10 WHERE id=$1 RETURNING *",
          [
            before.id,
            v.name,
            v.mobile,
            v.landline,
            v.language,
            v.preferred_channel,
            v.status,
            v.whatsapp_opt_in,
            v.whatsapp_opt_in ? (before.whatsapp_opt_in_at ?? clock()) : null,
            v.whatsapp_opt_in_source,
          ],
        )
      ).rows[0];
      await audit(
        db,
        clock,
        req.user,
        "staff.updated",
        "staff",
        r.id,
        before,
        r,
      );
      return {
        ...r,
        warnings:
          v.status !== "active"
            ? await futureStaffWarnings(db, r.id, clock)
            : [],
      };
    });
    res.json(row);
  });
  app.get("/api/sites/:id/staff", async (req, res) => {
    await siteAccess(pool, req.user, req.params.id);
    const { page, limit, offset } = pagination(req.query);
    const { rows } = await pool.query(
      "SELECT s.* FROM staff s JOIN site_staff l ON l.staff_id=s.id WHERE l.site_id=$1 AND l.active ORDER BY s.name,s.id LIMIT $2 OFFSET $3",
      [req.params.id, limit, offset],
    );
    const total = Number(
      (
        await pool.query(
          "SELECT count(*) FROM site_staff WHERE site_id=$1 AND active",
          [req.params.id],
        )
      ).rows[0].count,
    );
    res.json({ items: rows, total, page, limit });
  });
  app.post("/api/sites/:id/staff", async (req, res) => {
    admin(req.user);
    const ids = req.body?.staff_ids;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 5000 ||
      ids.some((id) => typeof id !== "string")
    )
      validation("staff_ids", "Provide 1 to 5000 staff IDs");
    const result = await mutate(pool, clock, async (db) => {
      const site = await siteAccess(db, req.user, req.params.id, 404, true);
      if (site.status !== "active") fail(409, "Site is inactive");
      let linked = 0,
        already_linked = 0;
      for (const id of new Set(ids)) {
        await staffAccess(db, req.user, id);
        const old = (
          await db.query(
            "SELECT * FROM site_staff WHERE site_id=$1 AND staff_id=$2 FOR UPDATE",
            [site.id, id],
          )
        ).rows[0];
        if (old?.active) {
          already_linked++;
          continue;
        }
        const r = (
          await db.query(
            "INSERT INTO site_staff(site_id,staff_id,linked_at) VALUES($1,$2,$3) ON CONFLICT(site_id,staff_id) DO UPDATE SET active=true,linked_at=EXCLUDED.linked_at RETURNING *",
            [site.id, id, clock()],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          req.user,
          "staff.linked",
          "site_staff",
          r.id,
          old ?? null,
          r,
          site.id,
        );
        linked++;
      }
      return { linked, already_linked };
    });
    res.json(result);
  });
  app.delete("/api/sites/:id/staff/:staffId", async (req, res) => {
    admin(req.user);
    const result = await mutate(pool, clock, async (db) => {
      await siteAccess(db, req.user, req.params.id);
      const old = (
        await db.query(
          "SELECT * FROM site_staff WHERE site_id=$1 AND staff_id=$2 FOR UPDATE",
          [req.params.id, req.params.staffId],
        )
      ).rows[0];
      if (!old) fail(404, "Link not found");
      if (old.active) {
        const r = (
          await db.query(
            "UPDATE site_staff SET active=false WHERE id=$1 RETURNING *",
            [old.id],
          )
        ).rows[0];
        await audit(
          db,
          clock,
          req.user,
          "staff.unlinked",
          "site_staff",
          r.id,
          old,
          r,
          req.params.id,
        );
      }
      return {
        ok: true,
        warnings: await futureStaffWarnings(
          db,
          req.params.staffId,
          clock,
          req.params.id,
        ),
      };
    });
    res.json(result);
  });
  app.get("/api/audit", async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const parameters = [req.user.role, req.user.id];
    let where =
      "($1='admin' OR EXISTS(SELECT 1 FROM site_managers m WHERE m.site_id=a.site_id AND m.user_id=$2))";
    if (
      req.query.entity_type !== undefined ||
      req.query.entity_id !== undefined
    ) {
      if (
        typeof req.query.entity_type !== "string" ||
        !/^[a-z_]{1,64}$/.test(req.query.entity_type)
      )
        validation("entity_type", "Provide an entity type with entity_id");
      if (!z.uuid().safeParse(req.query.entity_id).success)
        validation("entity_id", "Provide a valid entity ID with entity_type");
      parameters.push(req.query.entity_type, req.query.entity_id);
      where += " AND a.entity_type=$3 AND a.entity_id=$4";
      if (
        !(
          await pool.query(
            `SELECT 1 FROM audit_log a WHERE ${where} LIMIT 1`,
            parameters,
          )
        ).rowCount
      )
        fail(404, "Audit entity not found");
    }
    const { rows } = await pool.query(
      `SELECT a.*,a.before_data AS before,a.after_data AS after FROM audit_log a WHERE ${where} ORDER BY a.at DESC,a.id LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      [...parameters, limit, offset],
    );
    const total = Number(
      (
        await pool.query(
          `SELECT count(*) FROM audit_log a WHERE ${where}`,
          parameters,
        )
      ).rows[0].count,
    );
    res.json({ items: rows, total, page, limit });
  });
  registerManagement(app, { pool, clock });
  registerRoster(app, { pool, clock });
  registerDispatch(app, {
    pool,
    clock,
    validateChannels: runtime?.validateDispatch,
  });
  if (settings) settings.register(app);
  if (runtime)
    app.use("/api/mock", (req, res, next) => {
      if (req.channelState.mode !== "mock")
        return res.status(404).json({ message: "Not found" });
      next();
    });
  registerMessaging(app, {
    pool,
    clock,
    messagingMode: runtime ? "mock" : effectiveMode,
    messagingSecret,
  });
  if (pstn) pstn.register(app);
  app.use((req, res) => res.status(404).json({ message: "Not found" }));
  app.use((error, req, res, next) => {
    if (error instanceof AppError)
      return res.status(error.status).json({
        message: error.message,
        ...(error.errors ? { errors: error.errors } : {}),
        ...(error.warnings ? { warnings: error.warnings } : {}),
        ...(error.reason ? { reason: error.reason } : {}),
        ...(error.conflict ? { conflict: error.conflict } : {}),
      });
    if (error.code === "23505" || error.code === "23P01")
      return res.status(409).json({
        message:
          error.code === "23505" ? "Duplicate record" : "Overlapping shift",
      });
    if (error.code === "22P02" || error.type === "entity.parse.failed")
      return res.status(400).json({
        message: "Invalid input",
        errors: [{ field: "input", message: "Malformed input" }],
      });
    if (error.type === "entity.too.large")
      return res.status(400).json({ message: "Input exceeds 5 MB" });
    console.error(
      JSON.stringify({
        level: "error",
        event: "request.failed",
        message: error.message,
      }),
    );
    res.status(500).json({ message: "Internal server error" });
  });
  return app;
}
