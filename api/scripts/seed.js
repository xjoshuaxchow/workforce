import { createPool, transaction } from "../src/db.js";
import { hashPassword } from "../src/security.js";
const pool = createPool(process.env.DATABASE_URL);
try {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase(),
    password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw Error(
      "Set SEED_ADMIN_EMAIL and a private password of at least 12 characters",
    );
  const hash = await hashPassword(password);
  const result = await transaction(pool, async (db) => {
    const r = await db.query(
      "INSERT INTO users(email,name,password_hash,role) VALUES($1,'Local administrator',$2,'admin') ON CONFLICT(email) DO NOTHING RETURNING id",
      [email, hash],
    );
    if (r.rowCount)
      await db.query(
        "INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,after_data) VALUES('system',null,'user.created','user',$1,$2)",
        [r.rows[0].id, JSON.stringify({ email, role: "admin" })],
      );
    return r.rowCount;
  });
  console.log(
    result
      ? "Local administrator created. Password remains in the private .env file."
      : "Administrator already exists; password unchanged.",
  );
} finally {
  await pool.end();
}
