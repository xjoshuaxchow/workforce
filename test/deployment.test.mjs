import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
test('deployment setup creates private secrets once and never rotates an existing configuration',()=>{
 const dir=mkdtempSync(join(tmpdir(),'workforce-deploy-'));
 try {
  const env=join(dir,'.env');
  const run=()=>spawnSync('python3',[join(root,'scripts/setup-deploy.py'),'--file',env],{encoding:'utf8'});
  let result=run();assert.equal(result.status,0,result.stderr);
  const original=readFileSync(env,'utf8');assert.equal(statSync(env).mode&0o777,0o600);
  assert.match(original,/WORKFORCE_SETTINGS_KEY=.+/);assert.match(original,/WORKFORCE_DB_PASSWORD=[a-f0-9]{64}/);
  result=run();assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(env,'utf8'),original);
  assert.doesNotMatch(result.stdout,/WORKFORCE_DB_PASSWORD=/);
 } finally{rmSync(dir,{recursive:true,force:true});}
});
