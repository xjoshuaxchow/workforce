import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareVoiceFiles} from '../src/prepare-voice.js';
const item={language:'yue',purpose:'offer',hash:'a'.repeat(64),state:'missing'};
test('Automatic preparation skips ready audio, polls an existing generation, and never publishes',async()=>{
 const requests=[];let checks=0;
 await prepareVoiceFiles('work-one',{languages:[{required:[{...item,state:'ready'},{...item,purpose:'ack'}]}]},async(path,options)=>{
  requests.push({path,...options});return {state:++checks===1?'submitting':'ready'};
 },async()=>{});
 assert.equal(requests.length,2);
 for(const request of requests){assert.equal(request.path,'/requests/work-one/voice-synthesis');assert.equal(request.body.purpose,'ack');assert.equal(request.body.expectedHash,'a'.repeat(64));}
});
test('Optional English audition is generated without changing the employee language',async()=>{
 let submitted;
 await prepareVoiceFiles('work-one',{languages:[{previewOnly:true,required:[{...item,language:'en'}]}]},async(path,options)=>{submitted=options.body;return{state:'ready'};});
 assert.equal(submitted.language,'en');assert.equal(submitted.previewOnly,true);
});
test('A generation failure stops preparation before requesting later files',async()=>{
 let count=0;
 await assert.rejects(prepareVoiceFiles('work-one',{languages:[{required:[item,{...item,purpose:'ack'}]}]},async()=>{count++;throw Error('Unsupported text');}),/Unsupported text/);
 assert.equal(count,1);
});
