import {test} from 'node:test';
import assert from 'node:assert/strict';
const local=await import('../src/espeak-speech.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('Local runner rejects unsupported voices and invalid rate before launching any command',async()=>{
 assert.equal(typeof local.createEspeakClient,'function');
 const client=local.createEspeakClient();
 await assert.rejects(client.synthesize({voice:'yue; touch /tmp/nope',script:'test',rate:160}),/voice/i);
 await assert.rejects(client.synthesize({voice:'en-gb',script:'test',rate:999}),/rate/i);
});
