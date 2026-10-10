import {useCallback,useEffect,useRef,useState} from 'react';
import {Search,Plus,UploadCloud,Folder,FileText,Image,FileArchive,MoreHorizontal,ChevronRight,Trash2,RotateCcw,HardDrive,Share2,Download,ArrowLeft,Pencil,FolderPlus} from 'lucide-react';
import {api,friendlySize,type Workspace,type DriveNode} from '../api';
type Props={workspace:Workspace};
export default function Drive({workspace}:Props){
 const [folderId,setFolderId]=useState<string|null>(null);
 const [trail,setTrail]=useState<{id:string;name:string}[]>([]);
 const [trash,setTrash]=useState(false),[search,setSearch]=useState('');
 const [nodes,setNodes]=useState<DriveNode[]>([]),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [uploading,setUploading]=useState(false);
 const [usage,setUsage]=useState({usedBytes:'0',quotaBytes:workspace.quota_bytes});
 const fileInput=useRef<HTMLInputElement>(null);
 const base='/workspaces/'+workspace.id;
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const q=search.trim()?'?q='+encodeURIComponent(search.trim()):trash?'?trash=true':
    folderId?'?parentId='+folderId:'';
   const [listing,capacity]=await Promise.all([
    api<{nodes:DriveNode[]}>(base+'/nodes'+q),
    api<{usedBytes:string;quotaBytes:string}>(base+'/usage')]);
   setNodes(listing.nodes);setUsage(capacity);
  }catch(e){setError((e as Error).message);}finally{setLoading(false);}
 },[base,folderId,trash,search]);
 useEffect(()=>{void load();},[load]);
 async function action(path:string,method:string,json?:unknown){
  setError('');setNotice('');
  try{await api(base+path,{method,json});await load();}
  catch(e){setError((e as Error).message);}
 }
 function openFolder(item:DriveNode){
  if(trash)return;
  setSearch('');setFolderId(item.id);setTrail(prev=>[...prev,{id:item.id,name:item.name}]);
 }
 function goTo(depth:number){
  setSearch('');setTrash(false);
  const next=trail.slice(0,depth);
  setTrail(next);setFolderId(next.at(-1)?.id||null);
 }
 async function makeFolder(){
  const name=window.prompt('Name your new folder');if(!name?.trim())return;
  await action('/folders','POST',{name,parentId:folderId});
 }
 async function upload(files:FileList|null){
  if(!files?.length)return;
  setUploading(true);setError('');let done=0;
  try{
   for(const file of Array.from(files)){
    const form=new FormData();form.append('file',file);
    await api(base+'/upload'+(folderId?'?parentId='+folderId:''),{method:'POST',body:form});
    done++;
   }
   setNotice(done+' file'+(done===1?'':'s')+' uploaded successfully.');
   await load();
  }catch(e){setError('Uploaded '+done+' file(s). '+(e as Error).message);}
  finally{setUploading(false);if(fileInput.current)fileInput.current.value='';}
 }
 async function revokeLinks(item:DriveNode){
  if(!window.confirm('Revoke all active shared links for '+item.name+'?'))return;
  try{
   const result=await api<{revoked:number}>(base+'/nodes/'+item.id+'/shares',{method:'DELETE'});
   setNotice(result.revoked+' sharing link(s) revoked.');
  }catch(e){setError((e as Error).message);}
 }
 async function share(item:DriveNode){
  try{
   const result=await api<{url:string}>(base+'/nodes/'+item.id+'/shares',{method:'POST',json:{days:7}});
   try{await navigator.clipboard.writeText(result.url);setNotice('7-day download link copied to clipboard.');}
   catch{window.prompt('Copy your 7-day download link',result.url);}
  }catch(e){setError((e as Error).message);}
 }
 const percentage=Math.min(100,Number(usage.usedBytes)/Math.max(1,Number(usage.quotaBytes))*100);
 return <div className="drive-screen">
  <div className="topline"><div><span className="eyebrow">YOUR WORKSPACE</span>
   <h1>{trash?'Trash':search?'Search results':'My files'}</h1>
   <p className="muted">All your important things, right where you need them.</p></div>
   <div className="top-actions"><button className="outline" onClick={()=>void makeFolder()}><FolderPlus size={18}/> New folder</button>
    <button className="primary" disabled={uploading} onClick={()=>fileInput.current?.click()}><UploadCloud size={18}/> {uploading?'Uploading…':'Upload files'}</button>
    <input ref={fileInput} type="file" multiple hidden onChange={e=>void upload(e.target.files)}/></div>
  </div>
  <div className="metrics-row">
   <div className="metric"><div className="metric-icon"><HardDrive size={21}/></div><div><small>Storage used</small><strong>{friendlySize(usage.usedBytes)} <span>/ {friendlySize(usage.quotaBytes)}</span></strong></div>
    <div className="meter"><span style={{width:percentage+'%'}}/></div></div>
   <div className="metric secondary-metric"><div className="metric-icon"><Folder size={21}/></div>
    <div><small>Items in this view</small><strong>{nodes.length} <span>items</span></strong></div></div>
  </div>
  <div className="files-card">
   <div className="files-toolbar"><div className="view-tabs">
    <button className={!trash?'selected':''} onClick={()=>{setTrash(false);setSearch('');}}>My files</button>
    <button className={trash?'selected':''} onClick={()=>{setTrash(true);setSearch('');}}><Trash2 size={15}/> Trash</button>
   </div><div className="search-wrap"><Search size={17}/><input value={search} placeholder="Search files and folders" onChange={e=>{setSearch(e.target.value);setTrash(false);}}/></div></div>
   {!trash&&!search&&<div className="breadcrumbs"><button onClick={()=>goTo(0)}>My files</button>{trail.map((x,i)=><span key={x.id}><ChevronRight size={15}/><button onClick={()=>goTo(i+1)}>{x.name}</button></span>)}</div>}
   {error&&<div className="alert error" role="alert">{error}</div>}
   {notice&&<div className="alert success">{notice}</div>}
   <div className="file-head"><span>Name</span><span>Size</span><span>Actions</span></div>
   {loading?<div className="loading-list">Loading your files…</div>:nodes.length===0?
    <div className="empty-files"><div className="empty-illustration">{trash?<Trash2 size={35}/>:<Folder size={38}/>}</div>
    <h3>{trash?'Your trash is empty':search?'No results found':'A fresh start'}</h3>
    <p>{trash?'Deleted items will appear here.':search?'Try a different file name.':'Create a folder or upload your first file to get started.'}</p>
    {!trash&&!search&&<button className="outline" onClick={()=>fileInput.current?.click()}><Plus size={16}/> Add files</button>}</div>:
    <div className="file-list">{nodes.map(item=><div className="file-row" key={item.id}>
     <div className="file-name" onClick={()=>item.kind==='folder'&&openFolder(item)}>
      <span className={'file-icon '+(item.kind==='folder'?'is-folder':'')}>{item.kind==='folder'?<Folder size={23}/>:item.name.match(/\.(png|jpe?g|gif|webp)$/i)?<Image size={23}/>:item.name.match(/\.(zip|rar|7z)$/i)?<FileArchive size={23}/>:<FileText size={23}/>}</span>
      <span className="file-title">{item.name}<small>{item.kind==='folder'?'Folder':'File'}</small></span></div>
     <span className="file-size">{item.kind==='folder'?'—':friendlySize(item.size_bytes)}</span>
     <div className="file-actions">{trash?
      <><button title="Restore" onClick={()=>void action('/nodes/'+item.id+'/restore','POST')}><RotateCcw size={17}/></button>
      <button title="Delete forever" onClick={()=>window.confirm('Permanently delete '+item.name+'?')&&void action('/nodes/'+item.id,'DELETE')}><Trash2 size={17}/></button></>:
      <><button title="Download" disabled={item.kind==='folder'} onClick={()=>window.location.assign('/api'+base+'/nodes/'+item.id+'/download')}><Download size={17}/></button>
      <details className="item-menu"><summary aria-label={'Actions for '+item.name}><MoreHorizontal size={20}/></summary><div className="menu-items">
       {item.kind==='folder'&&<button onClick={()=>openFolder(item)}><Folder size={15}/> Open</button>}
       {item.kind==='file'&&<><button onClick={()=>void share(item)}><Share2 size={15}/> Share link</button><button onClick={()=>void revokeLinks(item)}><Trash2 size={15}/> Revoke links</button></>}
       <button onClick={()=>{const name=window.prompt('Rename',item.name);if(name?.trim())void action('/nodes/'+item.id,'PATCH',{name});}}><Pencil size={15}/> Rename</button>
       {folderId&&<button onClick={()=>void action('/nodes/'+item.id,'PATCH',{parentId:null})}><ArrowLeft size={15}/> Move to root</button>}
       <button onClick={()=>void action('/nodes/'+item.id+'/trash','POST')}><Trash2 size={15}/> Move to trash</button>
      </div></details></>}</div></div>)}</div>}
  </div>
 </div>;
}
