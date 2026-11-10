// Use one synthesis request per file so a cold first run does not hold a proxy
// connection open while preparing every prompt. Publication is a separate action.
export async function prepareVoiceFiles(requestId, preview, api, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (const plan of preview.languages) {
    for (const item of plan.required) {
      if (item.state === 'ready') continue;
      if (item.state === 'blocked') throw Error(item.issues.join(' '));
      let current = item;
      const deadline = Date.now() + 180000;
      do {
        current = await api(`/requests/${requestId}/voice-synthesis`, {method:'POST', body:{
          language:item.language, purpose:item.purpose, expectedHash:item.hash,
          ...(plan.previewOnly ? {previewOnly:true} : {}),
          ...(['unknown','archived'].includes(current.state) ? {retryGeneration:current.generation} : {}),
        }});
        if (current.state === 'ready') break;
        if (current.state !== 'submitting') throw Error(current.message || '語音準備失敗，請重試。');
        if (Date.now() >= deadline) throw Error('語音仍在準備中，請稍後重試。');
        await pause(1000);
      } while (true);
    }
  }
}
