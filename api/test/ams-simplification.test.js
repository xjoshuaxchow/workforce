import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSite, validateStaff, contactable } from '../src/domain.js';
import { defaultChannelConfig, publicChannelConfig } from '../src/channel-settings.js';
import { localSynthesisDescriptors } from '../src/voice-synthesis-content.js';
const site = { id:'site-one',name:'North Depot',address:'Hong Kong',timezone:'Asia/Hong_Kong' };
const work = { id:'work-one',channels:['voice'],start_at:'2099-11-10T00:00:00Z',end_at:'2099-11-10T08:00:00Z',message:'' };
test('New sites default to Hong Kong without requiring a timezone field',()=>{
 assert.equal(validateSite({code:'HK',name:'Hong Kong'}).timezone,'Asia/Hong_Kong');
});
test('Explicit notification consent records administrator confirmation without mandatory source entry',()=>{
 const staff=validateStaff({name:'Joshua',mobile:'+85296644718',whatsapp_opt_in:true});
 assert.equal(staff.whatsapp_opt_in_source,'admin_confirmation');
 assert.ok(contactable(staff).includes('whatsapp'));
 assert.ok(!contactable(validateStaff({name:'Joshua',mobile:'+85296644718'})).includes('whatsapp'));
});
test('Active channel settings support two languages and expose no Azure configuration',()=>{
 const config=defaultChannelConfig();
 assert.deepEqual(Object.keys(config.templates).sort(),['en','yue']);
 assert.equal(config.voiceSynthesis,undefined);
 const legacy={...config,voiceSynthesis:{key:'private-legacy-key',region:'eastasia'},voiceClips:{...config.voiceClips,mode:'azure-mp3'}};
 const visible=publicChannelConfig(legacy);
 assert.equal(visible.voiceClips.mode,'local-mp3');
 assert.equal(visible.voiceSynthesis,undefined);
});
test('Identical invitation content reuses its MP3 across work and site identifiers',()=>{
 const first=localSynthesisDescriptors({speed:1},'en',site,work)[0];
 const other=localSynthesisDescriptors({speed:1},'en',{...site,id:'another-site'},{...work,id:'another-work'})[0];
 assert.equal(other.hash,first.hash);
 assert.notEqual(localSynthesisDescriptors({speed:0.9},'en',site,work)[0].hash,first.hash);
});
test('Confirmation and cancellation audio are fixed and shared across different jobs',()=>{
 const first=localSynthesisDescriptors({speed:1},'yue',site,work);
 const other=localSynthesisDescriptors({speed:1},'yue',{...site,name:'另一地點'}, {...work,id:'other',start_at:'2099-12-12T01:00:00Z',message:'不同說明'});
 for(const purpose of ['confirmation','cancellation','ack','no_input','unavailable']){
  const a=first.find(i=>i.purpose===purpose),b=other.find(i=>i.purpose===purpose);
  assert.equal(a.hash,b.hash,purpose);assert.deepEqual(a.tokens,[]);assert.equal(a.shared,true);
  assert.doesNotMatch(a.script,/2099|North Depot/);
 }
});
test('New WhatsApp and Say invitations use Hong Kong time even for a historical foreign site',async()=>{
 const {buildPayload}=await import('../src/messaging.js');
 const {clipManifest}=await import('../src/voice-clips.js');
 const foreign={...site,timezone:'America/New_York'};
 const staff={name:'Test',mobile:'+6591234567',language:'en'};
 const payload=buildPayload({id:'attempt',channel:'voice',purpose:'offer'},staff,foreign,work);
 assert.equal(payload.variables.start_time,'08:00');assert.equal(payload.variables.end_time,'16:00');
 assert.match(payload.voice.script,/08:00/);assert.doesNotMatch(payload.voice.script,/19:00|03:00/);
 assert.ok(clipManifest('offer','en',foreign,work).main.includes('hour:8'));
});
