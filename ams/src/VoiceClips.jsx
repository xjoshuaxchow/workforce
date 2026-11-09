import React, { useEffect, useRef, useState } from "react";
import { api, loadAllPages } from "./api.js";
import { Field, ErrorNotice } from "./ui.jsx";
import { GeneratedRequestAudio } from "./GeneratedVoice.jsx";

const languages = [["yue", "粵語"], ["zh", "普通話"], ["en", "英語"]];
const languageName = code => languages.find(([key]) => key === code)?.[1] ?? code;
async function audioUpload(file, language, name) {
  if (!file || file.size > 3 * 1024 * 1024) throw Error("請選擇 3 MB 以內的 MP3 或 WAV。");
  const extension = file.name.split(".").at(-1).toLowerCase();
  if (!["mp3", "wav"].includes(extension)) throw Error("請使用 MP3 或 PCM 16-bit WAV。");
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("無法讀取錄音檔案"));
    reader.readAsDataURL(file);
  });
  return { name: name.slice(0,120), language, content_type: extension === "mp3" ? "audio/mpeg" : "audio/wav", data };
}
export function ClipLibrary({ draft, setDraft, savedVersion }) {
  const [language, setLanguage] = useState("yue"), [category, setCategory] = useState("提示"),
    [key, setKey] = useState("offer"), [catalog, setCatalog] = useState([]), [assets, setAssets] = useState([]),
    [error, setError] = useState(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => { setNotice(""); }, [savedVersion]);
  useEffect(() => {
    let active = true;
    setCatalog([]); setError(null); setNotice("");
    Promise.all([api(`/settings/voice-clips/catalog?language=${language}`), loadAllPages("/settings/voice-assets")])
      .then(([c,a]) => { if (active) { setCatalog(c.items); setAssets(a.items); } }).catch(e => active && setError(e));
    return () => { active = false; };
  }, [language]);
  const items = catalog.filter(item => item.category === category), selected = items.find(item => item.key === key) ?? items[0],
    mapping = draft.voiceClips.library[language], selectedId = selected ? mapping[selected.key] ?? "" : "",
    asset = assets.find(a => a.id === selectedId);
  const map = (id) => {
    if (!selected) return;
    setDraft(old => {
      const library = structuredClone(old.voiceClips.library);
      if (id) library[language][selected.key] = id;
      else delete library[language][selected.key];
      return { ...old, voiceClips: { ...old.voiceClips, library } };
    });
  };
  return <section className="panel settings-panel clip-library">
    <h2>自備錄音庫</h2>
    <p>預錄片段按班次資料自動依序播放。使用通用稱呼，不讀員工姓名；補充說明在調度草稿另外上傳。</p>
    <p className="muted">只需準備實際班次用到的片段。發佈前會列出缺漏，並檢查確認、取消及額滿通知。此模式不使用語音合成，仍有一般通話費用。片段間可能有短暫停頓。</p>
    <ErrorNotice error={error} />
    <div className="form-grid">
      <Field label="錄音語言" value={language} onChange={v => {setLanguage(v);setKey("offer");setCategory("提示");}} options={languages} disabled={busy} />
      <Field label="錄音分類" value={category} onChange={v => {setCategory(v);setKey("");setNotice("");}} options={[...new Set(catalog.map(i=>i.category))].map(c=>[c,c])} disabled={busy} />
      <Field label="錄音片段" value={selected?.key ?? ""} onChange={v=>{setKey(v);setNotice("");}} options={items.map(i=>[i.key,`${mapping[i.key] ? "已配對" : "未配對"} · ${i.label}`])} disabled={busy} />
    </div>
    {selected ? <div className="speech-workspace">
      <section className="speech-preview">
        <h3>{selected.label}</h3>
        <p className="muted">建議錄音內容</p>
        <p className="speech-preview-text">{selected.sample}</p>
        <p className="muted">可調整用詞，請保留數值、單位及按鍵。日期和時間會分段拼接，錄音時請用一致語速及音量，裁去首尾多餘靜音。</p>
        {category === "地點" && <p className="muted">請包含地點名稱及完整地址。Site 名稱、地址或時區改動後，需重新配對。</p>}
        {category === "年份數字" && <p className="muted">年份按四個數字逐字播放，例如二、零、二、八，再接「年」。英語不加「年」。</p>}
      </section>
      <div>
        <Field label="使用已有錄音" value={selectedId} onChange={map} disabled={busy} options={[["","尚未配對"],...assets.filter(a=>a.language===language).map(a=>[a.id,a.name])]} />
        {asset && <audio key={asset.id} aria-label="片段試聽" controls preload="none" src={asset.playback_path} />}
        <label className="field clip-upload"><span>上傳此片段錄音</span>
          <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy} onChange={async e=>{
            const file=e.target.files[0]; e.target.value=""; if(!file)return;
            setBusy(true);setError(null);setNotice("");
            try {
              const created=await api("/settings/voice-assets",{method:"POST",body:await audioUpload(file,language,`${selected.label} · ${file.name}`)});
              setAssets(old=>[...old,created]);map(created.id);setNotice("已加入此片段，請儲存設定。");
            } catch(error) {setError(error);} finally {setBusy(false);}
          }} />
        </label>
        {busy && <p>上傳中…</p>}{notice && <p role="status">{notice}</p>}
        <p className="muted">支援 MP3、PCM 16-bit WAV，每檔上限 3 MB。配對後按頁頂「儲存設定」生效，已發出工作保留原錄音。</p>
      </div>
    </div> : <p className="muted">{catalog.length ? "此分類尚無地點，請先建立 Site。" : "載入錄音清單中…"}</p>}
    <h3>{category}準備進度</h3>
    <div className="clip-slots">{items.map(item=><button type="button" className={selected?.key===item.key?"":"quiet"} key={item.key} disabled={busy} onClick={()=>{setKey(item.key);setNotice("");}}>{item.label} · {mapping[item.key]?"已配對":"未配對"}</button>)}</div>
  </section>;
}
function ClipSequence({ items }) {
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[error,setError]=useState(null);
  const audio=useRef(null), ready=items.length>0 && items.every(i=>i.playback_path);
  useEffect(()=>{setPlaying(false);setIndex(0);setError(null);},[items]);
  useEffect(()=>{
    if(playing && audio.current) audio.current.play().catch(()=>{setPlaying(false);setError(Error("無法播放錄音，請檢查檔案或再按試聽。"));});
    else audio.current?.pause();
  },[playing,index]);
  return <>
    <div className="actions"><button type="button" className="quiet" disabled={!ready} onClick={()=>{setIndex(0);setPlaying(true);setError(null);}}>連續試聽</button>
      {playing && <button type="button" className="quiet" onClick={()=>setPlaying(false)}>停止試聽</button>}
      {!ready && <span className="muted">補齊此通知的片段後可連續試聽。</span>}
    </div>
    <ErrorNotice error={error}/>
    {ready && <audio ref={audio} aria-label="拼接語音試聽" controls preload="none" src={items[index]?.playback_path}
      onEnded={()=>{if(playing && index+1<items.length)setIndex(index+1);else setPlaying(false);}}
      onError={()=>{setPlaying(false);setError(Error("錄音載入失敗，請重新整理再試。"));}} />}
    <ol className="clip-sequence">{items.map((item,i)=><li key={`${i}-${item.key}`}>
      <span>{item.key.startsWith("site:")?"地點與地址":item.label} · {item.sample}</span>
      {item.playback_path ? <a href={item.playback_path} target="_blank" rel="noreferrer">試聽片段</a> : <strong>欠錄音</strong>}
    </li>)}</ol>
  </>;
}
function LanguagePreview({ plan, request, reload }) {
  const [purpose,setPurpose]=useState("offer"),[busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState("");
  const kinds=[["offer","工作邀請"],["confirmation","接單確認"],["cancellation","取消通知"],["filled","額滿通知"]].filter(([key])=>plan.sequences[key]);
  const selectedPurpose=kinds.some(([key])=>key===purpose)?purpose:kinds[0]?.[0];
  return <section className="clip-language">
    <h3>{languageName(plan.language)}</h3>
    {plan.missing.length>0 ? <div className="notice error"><strong>尚欠錄音</strong><ul>{plan.missing.map(item=><li key={item.key}>{item.key.startsWith("site:")?"地點與地址":item.label} · {item.sample}</li>)}</ul></div> : <p className="notice">錄音已齊備，包含跟進通知。</p>}
    {plan.required.some(item=>item.key==='message') && <div className="clip-message">
      <p>補充說明：{request.message}</p>
      {request.status === "draft" && <label className="field"><span>補充說明錄音（{languageName(plan.language)}）</span><input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy} onChange={async e=>{
        const file=e.target.files[0];e.target.value="";if(!file)return;
        setBusy(true);setError(null);setNotice("");
        try {await api(`/requests/${request.id}/voice-audio`,{method:"POST",body:{...await audioUpload(file,plan.language,file.name),purpose:"message"}});await reload();setNotice("補充錄音已上傳");}
        catch(error){setError(error);}finally{setBusy(false);}
      }}/></label>}
      <ErrorNotice error={error}/>{notice && <p role="status">{notice}</p>}
    </div>}
    {kinds.length>0 && <><Field label={`試聽通知（${languageName(plan.language)}）`} value={selectedPurpose} onChange={setPurpose} options={kinds}/>
    <ClipSequence items={plan.sequences[selectedPurpose]}/></>}
  </section>;
}
export function RequestVoicePreview({ request }) {
  const [preview,setPreview]=useState(null),[error,setError]=useState(null),[audition,setAudition]=useState("");
  const candidateKey=request.candidates.map(c=>c.id).join(",");
  const activeAudition=request.status === "draft" ? audition : "";
  const previewPath=`/requests/${request.id}/voice-preview${activeAudition ? `?language=${activeAudition}` : ""}`;
  const currentPath=useRef(previewPath);
  currentPath.current=previewPath;
  const reload=async()=>{
    const path=currentPath.current;
    try {
      const result=await api(path);
      if(currentPath.current===path){setPreview(result);setError(null);}
      return result;
    } catch(error) {
      if(currentPath.current===path)setError(error);
      throw error;
    }
  };
  useEffect(()=>{
    let active=true;
    setPreview(null);
    api(previewPath).then(r=>{if(active){setPreview(r);setError(null);}}).catch(e=>active&&setError(e));
    return ()=>{active=false;};
  },[request.id,request.status,candidateKey,audition]);
  useEffect(()=>{
    if(!['azure-mp3','local-mp3'].includes(preview?.mode) || !preview.languages.some(plan=>plan.required.some(item=>item.state==='submitting')))return;
    const timer=setTimeout(()=>reload().catch(()=>{}),2000);
    return ()=>clearTimeout(timer);
  },[preview]);
  return <section className="panel settings-panel">
    <h2>調度電話語音</h2><ErrorNotice error={error}/>
    {!request.channels.includes("voice") && <p className="muted">員工無法使用 WhatsApp 時，確認、取消或額滿通知可能改用電話，亦需準備所需錄音。</p>}
    {!preview ? <p>載入語音設定中…</p> : preview.mode==='say' ? <>
      <p>電話會按員工語言自動朗讀本次地點、日期、時間及按鍵提示，毋須上傳錄音。</p>
      <p className="muted">使用 Site 時區。接受請按 1，拒絕請按 2，重聽請按 9。</p>
    </> : ['azure-mp3','local-mp3'].includes(preview.mode) ? <GeneratedRequestAudio request={request} preview={preview} reload={reload} audition={activeAudition} onAudition={setAudition}/> : <>
      <p>自備錄音模式。按 Site 時區播放兩邊完整日期時間及 UTC 時差，使用通用稱呼。接受請按 1，拒絕請按 2，重聽請按 9。</p>
      <p className="muted">共用片段在「通訊設定 → 電話語音」配對。下方試聽不會撥電話。</p>
      <button type="button" className="quiet" onClick={()=>reload().catch(()=>{})}>重新檢查錄音</button>
      {preview.languages.length===0 && <p className="muted">加入候選員工後會列出需要的語言錄音。</p>}
      {preview.languages.map(plan=><LanguagePreview key={plan.language} plan={plan} request={request} reload={reload}/>)}
    </>}
  </section>;
}
