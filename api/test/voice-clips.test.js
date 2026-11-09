import { test } from 'node:test';
import assert from 'node:assert/strict';
const clips = await import('../src/voice-clips.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND') return {}; throw e;});
import { voiceTwiml, voiceMessage } from '../src/twilio-pstn.js';
const site = { id:'11111111-1111-4111-8111-111111111111', name:'Depot', address:'1 Road', timezone:'Asia/Hong_Kong' };
test('MP3 dates use Site-local full dates across leap midnight without staff names', () => {
  assert.equal(typeof clips.clipManifest, 'function');
  const manifest = clips.clipManifest('offer','yue',site,{ start_at:'2028-02-28T15:30:00Z',end_at:'2028-02-28T16:00:00Z',message:'帶證件' });
  assert.deepEqual(manifest.main.slice(3,13), ['digit:2','digit:0','digit:2','digit:8','year','month:2','day:28','hour:23','minute:30','offset:+08:00']);
  assert.deepEqual(manifest.main.slice(14,24), ['digit:2','digit:0','digit:2','digit:8','year','month:2','day:29','hour:0','minute:0','offset:+08:00']);
  assert.deepEqual(manifest.main.slice(-2), ['message','keys']);
  assert.equal(manifest.main.some(k=>k.includes('staff')),false);
});
test('English year rollover and repeated DST clocks include explicit offset', () => {
  assert.equal(typeof clips.dateClipKeys, 'function');
  assert.deepEqual(clips.dateClipKeys('2027-12-31T16:00:00Z',site.timezone,'en'),['day:1','month:1','digit:2','digit:0','digit:2','digit:8','at','hour:0','minute:0','offset:+08:00']);
  assert.equal(clips.dateClipKeys('2026-11-01T05:30:00Z','America/New_York','en').at(-1),'offset:-04:00');
  assert.equal(clips.dateClipKeys('2026-11-01T06:30:00Z','America/New_York','en').at(-1),'offset:-05:00');
  assert.notEqual(clips.siteClipKey(site),clips.siteClipKey({...site,address:'2 Road'}));
});
test('MP3 Gather plays all fragments in order and uses recorded acknowledgements without Say', () => {
  const payload={options:[{id:'ACCEPT',dtmf:'1'}],voice:{audio:{main:['https://voice.test/a.mp3','https://voice.test/b.mp3'],ack:['https://voice.test/ack.mp3']}}};
  const xml=voiceTwiml(payload,'https://voice.test/gather');
  assert.match(xml,/<Gather[^>]*><Play>https:\/\/voice.test\/a.mp3<\/Play><Play>https:\/\/voice.test\/b.mp3<\/Play><\/Gather>/);
  assert.doesNotMatch(xml,/<Say/);
  assert.match(voiceMessage(payload),/<Play>https:\/\/voice.test\/ack.mp3<\/Play>/);
});
