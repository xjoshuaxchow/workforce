import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const path = resolve(".env");
if (existsSync(path))
  throw Error("Private .env already exists; refusing to replace credentials");
const password = randomBytes(24).toString("hex");
writeFileSync(
  path,
  `HOST=127.0.0.1\nPORT=8310\nAMS_ORIGIN=http://127.0.0.1:5210\nDATABASE_URL=postgresql://workforce_local:${password}@127.0.0.1:5432/workforce_local\nTEST_DATABASE_URL=postgresql://workforce_local:${password}@127.0.0.1:5432/workforce_test\nSEED_ADMIN_EMAIL=admin@workforce.local\nSEED_ADMIN_PASSWORD=${randomBytes(18).toString("base64url")}\nMESSAGING_MODE=mock\nMESSAGING_SECRET=${randomBytes(32).toString("hex")}\n`,
  { mode: 0o600 },
);
const sql = `\\set ON_ERROR_STOP on\nDO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='workforce_local') THEN RAISE EXCEPTION 'workforce_local role already exists; reconcile manually'; END IF; END $$;\nCREATE ROLE workforce_local LOGIN PASSWORD '${password}';\nCREATE DATABASE workforce_local OWNER workforce_local;\nCREATE DATABASE workforce_test OWNER workforce_local;\n`;
writeFileSync("/private/tmp/workforce-create-local.sql", sql, { mode: 0o600 });
console.log(
  "Private local environment and database setup SQL prepared; credentials were not printed.",
);
