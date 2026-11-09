import { test } from 'node:test';
import assert from 'node:assert/strict';
const content=await import('../src/voice-synthesis-content.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const azure=await import('../src/azure-speech.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const site={id:'site-one',name:'Depot & <Centre>',address:'1 Road',timezone:'Asia/Hong_Kong'};
const request={id:'work-one',channels:['voice'],start_at:'2099-11-10T15:30:00Z',end_at:'2099-11-10T17:00:00Z',message:'Bring ID'};
test('Full-file synthesis keeps complete Site dates and generic greeting, hashes actual content and reuses common prompts',()=>{
  assert.equal(typeof content.synthesisDescriptors,'function');
  const config=content.defaultVoiceSynthesis();
  const items=content.synthesisDescriptors(config,'en',site,request);
  const offer=items.find(x=>x.purpose==='offer');
  assert.match(offer.script,/Hello there/);assert.match(offer.script,/10 November 2099/);assert.match(offer.script,/11 November 2099/);assert.match(offer.script,/23:30/);assert.match(offer.script,/01:00/);assert.match(offer.script,/Press 1 to accept/);assert.match(offer.script,/Bring ID/);
  const changed=content.synthesisDescriptors(config,'en',{...site,address:'2 Road'},request);
  assert.notEqual(changed[0].hash,offer.hash);
  assert.equal(items.find(x=>x.purpose==='ack').hash,content.synthesisDescriptors(config,'en',site,{...request,id:'another-work'}).find(x=>x.purpose==='ack').hash);
  assert.ok(!content.synthesisDescriptors(config,'yue',site,{...request,channels:['whatsapp']}).some(x=>x.purpose==='offer'));
  assert.throws(()=>content.synthesisDescriptors(config,'fr',site,request),/language/i);
});
test('Azure REST sends escaped SSML, fixed MP3 format and key only to the chosen regional endpoint',async()=>{
  assert.equal(typeof azure.createAzureSpeechClient,'function');
  let seen;
  const client=azure.createAzureSpeechClient({region:'eastasia',key:'private-test-key'},async(url,options)=>{
    seen={url,options};return new Response(Buffer.from([1,2]),{headers:{'content-type':'audio/mpeg'}});
  });
  await client.synthesize({voice:'zh-HK-HiuMaanNeural',locale:'zh-HK',script:'中環 & <audio src="evil"/>'});
  assert.equal(seen.url,'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(seen.options.redirect,'error');
  assert.equal(seen.options.headers['Ocp-Apim-Subscription-Key'],'private-test-key');
  assert.equal(seen.options.headers['X-Microsoft-OutputFormat'],'audio-16khz-32kbitrate-mono-mp3');
  assert.match(seen.options.body,/中環 &amp; &lt;audio/);assert.doesNotMatch(seen.options.body,/<audio/);
  assert.throws(()=>azure.createAzureSpeechClient({region:'eastasia.evil/path',key:'secret'}),/region/i);
});
test('Azure rejection is safe to retry but network and 5xx remain uncertain without leaking response secrets',async()=>{
  assert.equal(typeof azure.createAzureSpeechClient,'function');
  for(const [status,uncertain] of [[401,false],[429,false],[500,true]]){
    const client=azure.createAzureSpeechClient({region:'eastasia',key:'private-test-key'},async()=>new Response('private-test-key',{status}));
    await assert.rejects(client.synthesize({voice:'en-GB-SoniaNeural',locale:'en-GB',script:'Hello'}),e=>e.uncertain===uncertain&&!e.message.includes('private-test-key'));
  }
});
