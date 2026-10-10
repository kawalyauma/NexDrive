import {useCallback,useEffect,useState} from 'react';
import {DownloadCloud,Pause,Play,RefreshCw,CheckCircle2,AlertTriangle,Radio,Clock,XCircle} from 'lucide-react';
import {api,friendlySize,type Workspace} from '../api';
type Service={enabled:boolean;state:string;message?:string;online:boolean;heartbeat_at?:string;last_pass_at?:string;next_pass_at?:string};
type Job={id:string;status:string;discovered:number;downloaded:number;posted:number;skipped:number;failed:number;bytes_downloaded:string;current_file?:string;current_bytes:string;current_total:string;error?:string;created_at:string};
type Totals={posted:number;skipped:number;failed:number;pending:number;bytes:string;last_file_at?:string};
type Item={id:string;file_name:string;size_bytes:string;status:string;edushare_resource_id?:string;error?:string;message_id:string;updated_at:string};
type Status={service:Service|null;job:Job|null;totals:Totals;items:Item[]};

const ago=(iso?:string)=>{if(!iso)return 'never';const s=Math.round((Date.now()-new Date(iso).getTime())/1000);return s<60?`${s}s ago`:s<3600?`${Math.round(s/60)} min ago`:`${Math.round(s/3600)} h ago`;};
const until=(iso?:string)=>{if(!iso)return '';const s=Math.max(0,Math.round((new Date(iso).getTime()-Date.now())/1000));return s<60?`in ${s}s`:`in ${Math.round(s/60)} min`;};

/** Live view of the always-on Telegram importer (it runs as its own service; this page never runs it). */
export default function TelegramImport({workspace}:{workspace:Workspace}){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[,tick]=useState(0);
 const base='/workspaces/'+workspace.id+'/plugins/telegram';
 const load=useCallback(async()=>{try{setStatus(await api<Status>(base+'/status'));setError('');}catch(e){setError((e as Error).message);}},[base]);
 useEffect(()=>{
  void load();
  const fast=setInterval(()=>{if(!document.hidden)void load();},2000);
  const clock=setInterval(()=>tick(t=>t+1),1000);
  return()=>{clearInterval(fast);clearInterval(clock);};
 },[load]);
 async function control(body:{enabled?:boolean;runNow?:boolean}){setBusy(true);try{await api(base+'/service',{method:'POST',json:body});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const s=status?.service,job=status?.job,t=status?.totals;
 const importing=s?.state==='importing'&&job?.status==='running';
 const total=Number(job?.current_total||0),done=Number(job?.current_bytes||0),percent=total?Math.min(100,Math.round(done*100/total)):0;
 const label=!s?'Service not started':!s.online?'Service offline':s.state==='importing'?(job?.current_file?'Downloading':'Checking the group for new files'):s.state==='watching'?'Up to date · watching for new files':s.state==='paused'?'Paused':s.state==='error'?'Problem · will retry':s.state;
 const tone=!s||!s.online||s.state==='error'?'bad':s.state==='paused'?'warn':'ok';
 return <div className="settings-screen telegram-screen"><div className="topline"><div><span className="eyebrow">NEXDRIVE SERVICE</span><h1>Telegram → EduShare</h1><p className="muted">Runs all the time: new teaching files in the Telegram group are saved to this drive and registered as drafts on Notesug.</p></div>
  <div className="toolbar-actions">
   {s?.enabled?<button className="secondary" disabled={busy} onClick={()=>void control({enabled:false})}><Pause size={17}/> Pause</button>:<button className="primary" disabled={busy} onClick={()=>void control({enabled:true,runNow:true})}><Play size={17}/> Resume</button>}
   <button className="icon-button" title="Check for new files now" disabled={busy||!s?.enabled||importing} onClick={()=>void control({runNow:true})}><RefreshCw size={18}/></button></div></div>
  {error&&<div className="alert error"><AlertTriangle size={16}/>{error}</div>}
  <section className="settings-panel telegram-progress">
   <div className="progress-title"><span className={'live-dot '+tone}><Radio size={20}/></span><div><strong>{label}</strong>
    <span>{s?.online?`Service alive · last check ${ago(s.last_pass_at)}${s.state==='watching'&&s.next_pass_at?` · next ${until(s.next_pass_at)}`:''}`:`No heartbeat ${s?.heartbeat_at?'since '+ago(s.heartbeat_at):''}. Restart the telegram-service container.`}</span></div>{importing&&total>0&&<b>{percent}%</b>}</div>
   {importing&&job?.current_file&&<><p className="current-file"><DownloadCloud size={16}/> {job.current_file} · {friendlySize(String(done))} of {friendlySize(String(total))}</p><div className="progress-track"><span style={{width:percent+'%'}}/></div></>}
   {s?.message&&s.state!=='watching'&&<p className={'alert '+(s.state==='error'?'error':'')}>{s.message}</p>}
   <div className="telegram-stats"><span><b>{t?.posted??0}</b> on EduShare</span><span><b>{t?.skipped??0}</b> duplicates</span><span><b>{t?.failed??0}</b> failed</span><span><b>{friendlySize(t?.bytes??'0')}</b> stored</span></div>
   {importing&&job&&<p className="muted">This run: {job.downloaded} downloaded · {job.posted} posted · {job.skipped} duplicates{job.failed?` · ${job.failed} failed`:''}</p>}
  </section>
  <section className="setting-section"><div className="section-heading"><div><h2>Latest files</h2><p>Newest first · last file {ago(t?.last_file_at)}</p></div></div>
   <div className="settings-panel telegram-items">{!status?.items.length?<p className="muted panel-note">No files yet.</p>:status.items.map(item=>
    <div className="member-row" key={item.id}><span className="member-avatar">{item.status==='failed'?<XCircle size={18}/>:item.status==='downloading'?<Clock size={18}/>:<CheckCircle2 size={18}/>}</span>
     <div className="member-info"><strong>{item.file_name}</strong><span>{friendlySize(item.size_bytes)} · {ago(item.updated_at)}{item.error?' · '+item.error:''}</span></div>
     {item.edushare_resource_id?<a className="role-pill" target="_blank" rel="noreferrer" href={'https://admin.notesug.com/resources/'+item.edushare_resource_id}>EduShare draft</a>:<span className="role-pill">{item.status==='skipped'?'duplicate':item.status}</span>}</div>)}</div></section>
 </div>;
}
