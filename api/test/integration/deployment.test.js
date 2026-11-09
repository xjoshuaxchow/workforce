import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createPool,migrate} from '../../src/db.js';
import {resetTestData} from '../test-db.js';
const url=new URL(process.env.TEST_DATABASE_URL);
assert.ok(url.hostname==='127.0.0.1'&&url.pathname.endsWith('_test'));
test('seed rerun preserves the database administrator after bootstrap inputs are removed',async()=>{
 const pool=createPool(url.toString());
 const seed=(email,password)=>spawnSync(process.execPath,['scripts/seed.js'],{cwd:new URL('../../',import.meta.url),env:{...process.env,DATABASE_URL:url.toString(),SEED_ADMIN_EMAIL:email,SEED_ADMIN_PASSWORD:password},encoding:'utf8'});
 try {
  await migrate(pool);await resetTestData(pool);
  let result=seed('docker-admin@test.local','Disposable-seed-password-123');assert.equal(result.status,0,result.stderr);
  const before=(await pool.query("SELECT id,password_hash FROM users WHERE email='docker-admin@test.local'")).rows[0];
  assert.match(before.password_hash,/^scrypt:/);
  result=seed('','');assert.equal(result.status,0,result.stderr);
  const after=(await pool.query("SELECT id,password_hash FROM users WHERE email='docker-admin@test.local'")).rows[0];assert.deepEqual(after,before);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n,1);
  await resetTestData(pool);
  result=seed('','');assert.notEqual(result.status,0);
 } finally {await pool.end();}
});
