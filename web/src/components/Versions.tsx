import {useCallback,useEffect,useRef,useState} from 'react';
import {Clock3,Download,RotateCcw,UploadCloud,X} from 'lucide-react';
import {api,friendlySize,type DriveNode} from '../api';
type Version={version_number:number;size_bytes:string;created_at:string};
type Data={current:Version;archived:Version[]};
export default function Versions({workspaceId,item,onClose,onChanged}:{
 workspaceId:string;item:DriveNode;onClose:()=>void;onChanged:()=>void;
}){
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),fileInput=useRef<HTMLInputElement>(null);
 const path='/workspaces/'+workspaceId+'/nodes/'+item.id+'/versions';
 const refresh=useCallback(async()=>{
  try{setData(await api<Data>(path));}catch(e){setError((e as Error).message);}
 },[path]);
 useEffect(()=>{void refresh();},[refresh]);
 async function upload(file:File|undefined){
  if(!file)return;setBusy(true);setError('');
  try{const body=new FormData();body.append('file',file);
   await api(path,{method:'POST',body});
   await refresh();onChanged();
  }catch(e){setError((e as Error).message);}finally{
   setBusy(false);if(fileInput.current)fileInput.current.value='';
  }
 }
 async function restore(version:number){
  if(!window.confirm('Restore version '+version+' as a new current version?'))return;
  setBusy(true);setError('');
  try{await api(path+'/'+version+'/restore',{method:'POST'});
   await refresh();onChanged();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const versions=data?[{...data.current,current:true},...data.archived.map(v=>({...v,current:false}))]:[];
 return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="dialog" role="dialog" aria-modal="true" aria-label={'Versions of '+item.name}>
   <div className="dialog-heading"><span className="dialog-icon"><Clock3 size={20}/></span>
    <div><h2>Version history</h2><p>{item.name}</p></div>
    <button className="icon-button" aria-label="Close" onClick={onClose}><X size={19}/></button></div>
   <div className="dialog-actions"><button className="primary" disabled={busy} onClick={()=>fileInput.current?.click()}>
    <UploadCloud size={17}/>{busy?'Working…':'Upload new version'}</button>
    <input hidden ref={fileInput} type="file" onChange={e=>void upload(e.target.files?.[0])}/></div>
   {error&&<div className="alert error">{error}</div>}
   <div className="version-list">{versions.map(v=><div className="version-row" key={v.version_number}>
    <span className="version-number">v{v.version_number}</span>
    <div className="member-info"><strong>{v.current?'Current version':'Earlier version'}</strong>
     <span>{friendlySize(v.size_bytes)} · {new Date(v.created_at).toLocaleString()}</span></div>
    <button title="Download version" className="icon-button" onClick={()=>
     window.location.assign('/api'+path+'/'+v.version_number+'/download')}><Download size={18}/></button>
    {!v.current&&<button className="outline small-button" disabled={busy} onClick={()=>void restore(v.version_number)}>
     <RotateCcw size={15}/> Restore</button>}
   </div>)}</div>
   {!data&&!error&&<p className="muted">Loading versions…</p>}
  </div>
 </div>;
}
