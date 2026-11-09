import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
for (const [task,args] of [
 ['whatsapp-up',['up','--build','-d']],
 ['whatsapp-key',['exec','-T','api','node','dist/cli.js','api-key']],
]) test(`${task} uses the dedicated workforce-whatsapp Compose project`,()=>{
 const folder=mkdtempSync(join(tmpdir(),'workforce-command-'));
 try {
  const bin=join(folder,'bin'),capture=join(folder,'arguments.json');mkdirSync(bin);
  writeFileSync(join(bin,'docker'),'#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.COMMAND_CAPTURE,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n',{mode:0o755});
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/project.mjs',import.meta.url)),task],{env:{...process.env,PATH:bin+delimiter+process.env.PATH,COMMAND_CAPTURE:capture},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const command=JSON.parse(readFileSync(capture,'utf8'));
  assert.deepEqual(command.args,['compose','--project-name','workforce-whatsapp',...args]);
  assert.equal(command.cwd,fileURLToPath(new URL('../whatsapp-microservice',import.meta.url)));
 } finally {rmSync(folder,{recursive:true,force:true});}
});
