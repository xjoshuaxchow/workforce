import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const content = await import('../src/voice-synthesis-content.js');
const local = await import('../src/local-speech.js').catch(e => { if(e.code==='ERR_MODULE_NOT_FOUND') return {}; throw e; });
const site={id:'site-one',name:'九龍灣',address:'測試辦公室',timezone:'Asia/Hong_Kong'};
const request={id:'work-one',channels:['voice'],start_at:'2099-11-10T15:30:00Z',end_at:'2099-11-10T17:00:00Z',message:'請帶身份證'};
test('English local scripts use Site spoken aliases without altering Cantonese content',()=>{
  const aliases={...site,voice_name_en:'Tech Nine',voice_address_en:'28/F, 9 Wing Hong Street'};
  const en=content.localSynthesisDescriptors({speed:1},'en',aliases,{...request,message:''})[0];
  assert.match(en.script,/Tech Nine/);assert.match(en.script,/Wing Hong Street/);assert.doesNotMatch(en.script,/九龍灣|測試辦公室/);
  const yue=content.localSynthesisDescriptors({speed:1},'yue',aliases,request)[0];
  assert.equal(yue.hash,content.localSynthesisDescriptors({speed:1},'yue',site,request)[0].hash);
});
test('Local MP3 speaks Hong Kong time without GMT',()=>{
  for(const language of ['en','yue']){
    const local=content.localSynthesisDescriptors({speed:1},language,site,request)[0];
    assert.doesNotMatch(local.script,/GMT|UTC/);
    assert.match(local.script,language==='yue'?/23點30分/:/23:30/);
    assert.match(local.script,language==='yue'?/1點00分/:/01:00/);
  }
});
test('Local failure exposes only controlled unsupported characters, never raw process logs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'local-error-test-'));
  try {
    const script=join(root,'worker.js');
    await writeFile(script,`process.stderr.write('private server details\\nWORKFORCE_TTS_ERROR '+JSON.stringify({code:'unsupported_characters',characters:['🪪']})+'\\n');process.exit(1);`);
    const client=local.createLocalSpeechClient({root,python:process.execPath,script});
    const descriptor={...content.localSynthesisDescriptors({speed:1},'yue',site,request)[0],script:'請帶🪪'};
    await assert.rejects(client.synthesize(descriptor),e=>e.message.includes('🪪')&&!e.message.includes('private server'));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Installed status recognizes the original Piper archive filenames',async()=>{
  const root=await mkdtemp(join(tmpdir(),'local-status-test-'));
  try {
    await mkdir(join(root,'yue'),{recursive:true});await mkdir(join(root,'en/espeak-ng-data'),{recursive:true});
    await writeFile(join(root,'installed.json'),JSON.stringify({version:'local-v1'}));
    for(const file of ['yue/vits-cantonese-hf-xiaomaiiwn.onnx','yue/lexicon.txt','yue/tokens.txt','yue/rule.fst','en/en_US-lessac-medium.onnx','en/tokens.txt','en/espeak-ng-data/phontab'])await writeFile(join(root,file),'fixture');
    const result=await local.createLocalSpeechClient({root,python:process.execPath}).status();
    assert.equal(result.installed,true);assert.deepEqual(result.languages.sort(),['en','yue']);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('Local full-file hashes isolate providers and invalidate changed scripts/speed while sharing generic endings',()=>{
  assert.equal(typeof content.localSynthesisDescriptors,'function');
  const items=content.localSynthesisDescriptors({speed:1},'yue',site,request);
  const offer=items[0];
  assert.match(offer.script,/同事/);assert.match(offer.script,/2099年11月10日/);assert.match(offer.script,/2099年11月11日/);
  assert.match(offer.script,/九龍灣/);assert.match(offer.script,/身份證/);
  assert.notEqual(offer.hash,content.localSynthesisDescriptors({speed:0.9},'yue',site,request)[0].hash);
  assert.notEqual(offer.hash,content.localSynthesisDescriptors({speed:1},'yue',{...site,address:'另一地點'},request)[0].hash);
  assert.equal(items[3].hash,content.localSynthesisDescriptors({speed:1},'yue',site,{...request,id:'another'})[3].hash);
  assert.match(content.localSynthesisDescriptors({speed:1},'en',site,request)[0].voice,/piper/);
  assert.throws(()=>content.localSynthesisDescriptors({speed:1},'zh',site,request),/language/i);
});
test('Local adapter rejects unsupported voices and unsafe input before starting any process',async()=>{
  assert.equal(typeof local.createLocalSpeechClient,'function');
  const client=local.createLocalSpeechClient();
  await assert.rejects(client.synthesize({voice:'unknown',language:'yue',script:'你好',speed:1}),/voice/i);
  const voice=content.localSynthesisDescriptors({speed:1},'yue',site,request)[0].voice;
  for(const patch of [{speed:0},{script:'\0'},{script:'a'.repeat(6001)}])
    await assert.rejects(client.synthesize({voice,language:'yue',script:'你好',speed:1,...patch}),/Invalid/i);
});
test('Local child failure is retryable and does not expose stderr or leave temporary files',async()=>{
  assert.equal(typeof local.createLocalSpeechClient,'function');
  const root=await mkdtemp(join(tmpdir(),'local-speech-test-'));
  try {
    const script=join(root,'fake.js');
    await writeFile(script,"process.stderr.write('private server path and secret'); process.exit(1);");
    const client=local.createLocalSpeechClient({root,python:process.execPath,script});
    const descriptor=content.localSynthesisDescriptors({speed:1},'yue',site,request)[0];
    await assert.rejects(client.synthesize(descriptor),e=>e.uncertain===false&&!e.message.includes('private'));
  } finally {await rm(root,{recursive:true,force:true});}
});
test('Concurrent local requests queue native processes instead of failing on engine contention',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-queue-test-'));
 try {
  const {readFile}=await import('node:fs/promises');
  const bytes=await readFile(new URL('./fixtures/silence.mp3',import.meta.url));
  const script=join(root,'fake-engine.mjs');
  await writeFile(script,`import{mkdir,writeFile,rm}from'node:fs/promises';
const lock=${JSON.stringify(join(root,'process.lock'))};
await mkdir(lock);await new Promise(r=>setTimeout(r,40));
await writeFile(process.argv[process.argv.indexOf('--output')+1],Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64'));
await rm(lock,{recursive:true});`);
  const client=local.createLocalSpeechClient({root,python:process.execPath,script});
  const descriptor=content.localSynthesisDescriptors({speed:1},'yue',site,request)[0];
  const results=await Promise.all([client.synthesize(descriptor),client.synthesize(descriptor)]);
  for(const result of results)assert.deepEqual(result,bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});
