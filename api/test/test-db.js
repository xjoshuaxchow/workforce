import assert from "node:assert/strict";

export async function resetTestData(pool) {
  const { rows } = await pool.query(
    "SELECT current_database() AS name, host(inet_server_addr()) AS host",
  );
  assert.equal(rows[0].host, "127.0.0.1", "Cleanup is local-only");
  assert.ok(rows[0].name.endsWith("_test"), "Cleanup requires a test database");
  // Jobs and raw events have no parent FK, so CASCADE alone does not clear them.
  await pool.query(
    "TRUNCATE users,staff,sites,audit_log,jobs,message_events,message_deliveries,messaging_settings_active,messaging_settings_versions,voice_assets CASCADE",
  );
}
