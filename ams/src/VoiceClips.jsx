import { prepareVoiceFiles } from "./prepare-voice.js";
import React, { useEffect, useRef, useState } from "react";
import { api, loadAllPages } from "./api.js";
import { hasMessage, t } from "./i18n.js";
import { useI18n } from "./i18n.jsx";
import { Field, ErrorNotice } from "./ui.jsx";
import { GeneratedRequestAudio } from "./GeneratedVoice.jsx";

const clipLanguages = () => [["yue", t("language.yue")], ["en", t("language.en")]];
const languageName = code => hasMessage(`language.${code}`) ? t(`language.${code}`) : code;
const categoryKeys = { 提示: "prompt", 年份數字: "digit", 月份: "month", 日期: "day", 小時: "hour", 分鐘: "minute", 時差: "offset", 地點: "site" };
const categoryLabel = category => {
  const key = categoryKeys[category];
  return key ? t(`clips.category.${key}`) : category;
};
const clipLabel = item => {
  const [key, value] = item.key.split(":", 2);
  if (key === "site") return item.label;
  const label = `clips.item.${key}`;
  return hasMessage(label) ? t(label, { value }) : item.label;
};
async function audioUpload(file, language, name) {
  if (!file || file.size > 3 * 1024 * 1024) throw Error(t("clips.tooLarge"));
  const extension = file.name.split(".").at(-1).toLowerCase();
  if (!["mp3", "wav"].includes(extension)) throw Error(t("clips.badType"));
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error(t("clips.unreadable")));
    reader.readAsDataURL(file);
  });
  return { name: name.slice(0,120), language, content_type: extension === "mp3" ? "audio/mpeg" : "audio/wav", data };
}
export function ClipLibrary({ draft, setDraft, savedVersion }) {
  useI18n();
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
    <h2>{t("clips.title")}</h2>
    <p>{t("clips.intro")}</p>
    <p className="muted">{t("clips.hint")}</p>
    <ErrorNotice error={error} />
    <div className="form-grid">
      <Field label={t("clips.language")} value={language} onChange={v => {setLanguage(v);setKey("offer");setCategory("提示");}} options={clipLanguages()} disabled={busy} />
      <Field label={t("clips.category")} value={category} onChange={v => {setCategory(v);setKey("");setNotice("");}} options={[...new Set(catalog.map(i=>i.category))].map(c=>[c,categoryLabel(c)])} disabled={busy} />
      <Field label={t("clips.slot")} value={selected?.key ?? ""} onChange={v=>{setKey(v);setNotice("");}} options={items.map(i=>[i.key, t("clips.slotOption", { state: mapping[i.key] ? t("clips.mapped") : t("clips.unmapped"), label: clipLabel(i) })])} disabled={busy} />
    </div>
    {selected ? <div className="speech-workspace">
      <section className="speech-preview">
        <h3>{clipLabel(selected)}</h3>
        <p className="muted">{t("clips.sampleTitle")}</p>
        <p className="speech-preview-text">{selected.sample}</p>
        <p className="muted">{t("clips.sampleHint")}</p>
        {category === "地點" && <p className="muted">{t("clips.siteHint")}</p>}
        {category === "年份數字" && <p className="muted">{t("clips.yearHint")}</p>}
      </section>
      <div>
        <Field label={t("clips.useExisting")} value={selectedId} onChange={map} disabled={busy} options={[["", t("clips.notMappedYet")],...assets.filter(a=>a.language===language).map(a=>[a.id,a.name])]} />
        {asset && <audio key={asset.id} aria-label={t("clips.preview")} controls preload="none" src={asset.playback_path} />}
        <label className="field clip-upload"><span>{t("clips.upload")}</span>
          <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy} onChange={async e=>{
            const file=e.target.files[0]; e.target.value=""; if(!file)return;
            setBusy(true);setError(null);setNotice("");
            try {
              const created=await api("/settings/voice-assets",{method:"POST",body:await audioUpload(file,language,`${selected.label} · ${file.name}`)});
              setAssets(old=>[...old,created]);map(created.id);setNotice(t("clips.uploaded"));
            } catch(error) {setError(error);} finally {setBusy(false);}
          }} />
        </label>
        {busy && <p>{t("clips.uploading")}</p>}{notice && <p role="status">{notice}</p>}
        <p className="muted">{t("clips.uploadHint")}</p>
      </div>
    </div> : <p className="muted">{catalog.length ? t("clips.noSites") : t("clips.loading")}</p>}
    <h3>{t("clips.progress", { category: categoryLabel(category) })}</h3>
    <div className="clip-slots">{items.map(item=><button type="button" className={selected?.key===item.key?"":"quiet"} key={item.key} disabled={busy} onClick={()=>{setKey(item.key);setNotice("");}}>{clipLabel(item)} · {mapping[item.key]?t("clips.mapped"):t("clips.unmapped")}</button>)}</div>
  </section>;
}
function ClipSequence({ items }) {
  useI18n();
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[error,setError]=useState(null);
  const audio=useRef(null), ready=items.length>0 && items.every(i=>i.playback_path);
  useEffect(()=>{setPlaying(false);setIndex(0);setError(null);},[items]);
  useEffect(()=>{
    if(playing && audio.current) audio.current.play().catch(()=>{setPlaying(false);setError(Error(t("clips.playFailed")));});
    else audio.current?.pause();
  },[playing,index]);
  return <>
    <div className="actions"><button type="button" className="quiet" disabled={!ready} onClick={()=>{setIndex(0);setPlaying(true);setError(null);}}>{t("clips.playAll")}</button>
      {playing && <button type="button" className="quiet" onClick={()=>setPlaying(false)}>{t("clips.stop")}</button>}
      {!ready && <span className="muted">{t("clips.needClips")}</span>}
    </div>
    <ErrorNotice error={error}/>
    {ready && <audio ref={audio} aria-label={t("clips.sequencePreview")} controls preload="none" src={items[index]?.playback_path}
      onEnded={()=>{if(playing && index+1<items.length)setIndex(index+1);else setPlaying(false);}}
      onError={()=>{setPlaying(false);setError(Error(t("clips.loadFailed")));}} />}
    <ol className="clip-sequence">{items.map((item,i)=><li key={`${i}-${item.key}`}>
      <span>{item.key.startsWith("site:") ? t("clips.siteAndAddress") : clipLabel(item)} · {item.sample}</span>
      {item.playback_path ? <a href={item.playback_path} target="_blank" rel="noreferrer">{t("clips.playClip")}</a> : <strong>{t("clips.missingClip")}</strong>}
    </li>)}</ol>
  </>;
}
function LanguagePreview({ plan, request, reload }) {
  useI18n();
  const [purpose,setPurpose]=useState("offer"),[busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState("");
  const kinds=[["offer", t("purpose.offer")], ["confirmation", t("purpose.confirmation")], ["cancellation", t("purpose.cancellation")], ["filled", t("purpose.filled")]].filter(([key])=>plan.sequences[key]);
  const selectedPurpose=kinds.some(([key])=>key===purpose)?purpose:kinds[0]?.[0];
  return <section className="clip-language">
    <h3>{languageName(plan.language)}</h3>
    {plan.missing.length>0 ? <div className="notice error"><strong>{t("clips.missingTitle")}</strong><ul>{plan.missing.map(item=><li key={item.key}>{clipLabel(item)} · {item.sample}</li>)}</ul></div> : <p className="notice">{t("clips.complete")}</p>}
    {plan.required.some(item=>item.key==='message') && <div className="clip-message">
      <p>{t("clips.extra", { message: request.message })}</p>
      {request.status === "draft" && <label className="field"><span>{t("clips.extraUpload", { language: languageName(plan.language) })}</span><input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy} onChange={async e=>{
        const file=e.target.files[0];e.target.value="";if(!file)return;
        setBusy(true);setError(null);setNotice("");
        try {await api(`/requests/${request.id}/voice-audio`,{method:"POST",body:{...await audioUpload(file,plan.language,file.name),purpose:"message"}});await reload();setNotice(t("clips.extraUploaded"));}
        catch(error){setError(error);}finally{setBusy(false);}
      }}/></label>}
      <ErrorNotice error={error}/>{notice && <p role="status">{notice}</p>}
    </div>}
    {kinds.length>0 && <><Field label={t("clips.previewNotice", { language: languageName(plan.language) })} value={selectedPurpose} onChange={setPurpose} options={kinds}/>
    <ClipSequence items={plan.sequences[selectedPurpose]}/></>}
  </section>;
}
export function RequestVoicePreview({ request, onPreparing }) {
  useI18n();
  const [preview,setPreview]=useState(null),[error,setError]=useState(null),[audition,setAudition]=useState(""),[preparing,setPreparing]=useState(false);
  const prepared = useRef(new Set());
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
  useEffect(() => { onPreparing?.(preparing); return () => onPreparing?.(false); }, [preparing, onPreparing]);
  useEffect(() => {
    if (preparing || request.status !== "draft" || preview?.mode !== "local-mp3" || !preview.configured) return;
    const items = preview.languages.flatMap(plan => plan.required);
    if (!items.length || items.every(item => item.state === "ready") || items.some(item => item.state === "blocked")) return;
    const key = request.id + ":" + items.map(item => item.hash).sort().join(":");
    if (prepared.current.has(key)) return;
    prepared.current.add(key);
    setPreparing(true); setError(null);
    prepareVoiceFiles(request.id, preview, api)
      .then(() => reload())
      .catch(async error => { setError(error); await reload().catch(() => {}); })
      .finally(() => setPreparing(false));
  }, [preview, request.id, request.status, activeAudition, preparing]);
  return <section className="panel settings-panel">
    <h2>{t("clips.requestTitle")}</h2><ErrorNotice error={error}/>{preparing && <p role="status">{t("clips.preparing")}</p>}
    {!request.channels.includes("voice") && <p className="muted">{t("clips.fallbackVoice")}</p>}
    {!preview ? <p>{t("clips.loadingPreview")}</p> : preview.mode==='say' ? <>
      <p>{t("clips.sayIntro")}</p>
      <p className="muted">{t("clips.sayKeys")}</p>
    </> : ['azure-mp3','local-mp3'].includes(preview.mode) ? <GeneratedRequestAudio request={request} preview={preview} reload={reload} audition={activeAudition} onAudition={setAudition} preparing={preparing}/> : <>
      <p>{t("clips.libraryIntro")}</p>
      <p className="muted">{t("clips.libraryHint")}</p>
      <button type="button" className="quiet" onClick={()=>reload().catch(()=>{})}>{t("clips.recheck")}</button>
      {preview.languages.length===0 && <p className="muted">{t("clips.needCandidates")}</p>}
      {preview.languages.map(plan=><LanguagePreview key={plan.language} plan={plan} request={request} reload={reload}/>)}
    </>}
  </section>;
}
