import { transaction } from "./db.js";
import { fail } from "./domain.js";
import { channelRequestContext } from "./channel-context.js";
export async function mutate(pool, clock, operation) {
  return transaction(pool, async (db) => {
    await db.query("SELECT set_config('workforce.now',$1,true)", [
      clock().toISOString(),
    ]);
    const expected = channelRequestContext.getStore()?.settingsVersion;
    if (expected) {
      const active = (
        await db.query(
          "SELECT version_id FROM messaging_settings_active WHERE singleton FOR SHARE",
        )
      ).rows[0];
      if (active?.version_id !== expected)
        fail(409, "Settings changed; refresh before retrying", {
          reason: "settings_revision_changed",
        });
    }
    return operation(db);
  });
}
export async function audit(
  db,
  clock,
  user,
  action,
  type,
  id,
  before,
  after,
  siteId = null,
  metadata = {},
) {
  await db.query(
    "INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,site_id,before_data,after_data,metadata,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      user?.actor_type ?? "user",
      user?.id ?? null,
      action,
      type,
      id,
      siteId,
      before,
      after,
      metadata,
      clock(),
    ],
  );
}
export function admin(user) {
  if (user.role !== "admin") fail(403, "Administrator access required");
}
export async function siteAccess(db, user, id, denied = 404, lock = false) {
  const { rows } = await db.query(
    `SELECT s.* FROM sites s WHERE s.id=$1${lock ? " FOR SHARE" : ""}`,
    [id],
  );
  if (!rows[0]) fail(404, "Site not found");
  if (user.role !== "admin") {
    const link = await db.query(
      "SELECT 1 FROM site_managers WHERE site_id=$1 AND user_id=$2",
      [id, user.id],
    );
    if (!link.rowCount) fail(denied, "Site not available");
  }
  return rows[0];
}
export async function staffAccess(db, user, id) {
  const { rows } = await db.query(
    "SELECT s.* FROM staff s WHERE s.id=$1 AND ($2='admin' OR EXISTS(SELECT 1 FROM site_staff l JOIN site_managers m ON m.site_id=l.site_id WHERE l.staff_id=s.id AND l.active AND m.user_id=$3))",
    [id, user.role, user.id],
  );
  if (!rows[0]) fail(404, "Staff not found");
  return rows[0];
}
