import {useCallback,useEffect,useState} from 'react';
import {KeyRound,Users,Plus,Copy,Trash2,ShieldCheck,Info,Check,UserPlus,Github} from 'lucide-react';
import {api,type Workspace} from '../api';
import AccountSecurity from './AccountSecurity';
type Member={id:string;name:string;email:string;role:string};
type ServiceKey={id:string;name:string;permission:string;created_at:string};
type Activity={id:string;action:string;created_at:string;details:Record<string,unknown>};
export default function Settings({workspace}: {workspace:Workspace}){
 const [members,setMembers]=useState<Member[]>([]),[keys,setKeys]=useState<ServiceKey[]>([]);
 const [activity,setActivity]=useState<Activity[]>([]);
 const [email,setEmail]=useState(''),[role,setRole]=useState<'member'|'admin'>('member');
 const [keyName,setKeyName]=useState(''),[permission,setPermission]=useState<'read'|'write'>('read');
 const [secret,setSecret]=useState(''),[inviteUrl,setInviteUrl]=useState('');
 const [freshMode,setFreshMode]=useState<'licensed_downloads'|'all_downloads'>('licensed_downloads');
 const [message,setMessage]=useState(''),[error,setError]=useState('');
 const isAdmin=workspace.role!=='member';
 const base='/workspaces/'+workspace.id;
 const load=useCallback(async()=>{
  if(!isAdmin)return;
  try{
   const [m,k,events,fresh]=await Promise.all([
    api<{members:Member[]}>(base+'/members'),
    api<{keys:ServiceKey[]}>(base+'/api-keys'),
    api<{events:Activity[]}>(base+'/activity'),
    api<{mode:'licensed_downloads'|'all_downloads'}>(base+'/plugins/fresh-teacher/settings')]);
   setMembers(m.members);setKeys(k.keys);setActivity(events.events);setFreshMode(fresh.mode);
  }catch(e){setError((e as Error).message);}
 },[base,isAdmin]);
 useEffect(()=>{void load();},[load]);
 async function invite(e:React.FormEvent){
  e.preventDefault();setError('');setInviteUrl('');
  try{
   const result=await api<{url:string}>(base+'/invitations',{method:'POST',json:{email,role}});
   setInviteUrl(result.url);setEmail('');setMessage('Invitation link created. Send it to the invited person.');
  }catch(err){setError((err as Error).message);}
 }
 async function createKey(e:React.FormEvent){
  e.preventDefault();setError('');
  try{
   const result=await api<{token:string}>(base+'/api-keys',{method:'POST',
    json:{name:keyName,permission}});
   setSecret(result.token);setKeyName('');setMessage('Key created. Copy it now — it will not be shown again.');
   await load();
  }catch(err){setError((err as Error).message);}
 }
 async function setMemberRole(member:Member,role:'member'|'admin'){
  try{await api(base+'/members/'+member.id,{method:'PATCH',json:{role}});await load();}
  catch(e){setError((e as Error).message);}
 }
 async function removeMember(member:Member){
  if(!window.confirm('Remove '+member.name+' from '+workspace.name+'?'))return;
  try{await api(base+'/members/'+member.id,{method:'DELETE'});await load();}
  catch(e){setError((e as Error).message);}
 }
 async function revoke(id:string){
  if(!window.confirm('Revoke this API key immediately?'))return;
  try{await api(base+'/api-keys/'+id,{method:'DELETE'});await load();}
  catch(err){setError((err as Error).message);}
 }
 async function copy(value:string){
  try{await navigator.clipboard.writeText(value);setMessage('Copied to clipboard.');}
  catch{window.prompt('Copy this value',value);}
 }
 async function saveFreshMode(e:React.FormEvent){
  e.preventDefault();setError('');
  try{await api(base+'/plugins/fresh-teacher/settings',{method:'PATCH',json:{mode:freshMode}});setMessage('Fresh Teacher download policy saved. The plugin is restarting.');}
  catch(err){setError((err as Error).message);}
 }
 return <div className="settings-screen">
  <div className="topline"><div><span className="eyebrow">WORKSPACE SETTINGS</span><h1>People & integrations</h1>
   <p className="muted">Manage who can access your space and how other apps connect.</p></div></div>
  {error&&<div className="alert error" role="alert">{error}</div>}
  {message&&<div className="alert success"><Check size={16}/>{message}</div>}
  <div className="setting-section">
   <div className="section-heading"><div className="section-icon"><Users size={22}/></div>
    <div><h2>Workspace members</h2><p>People with access to {workspace.name}.</p></div></div>
   <div className="settings-panel">
    {isAdmin?members.map(member=><div className="member-row" key={member.id}>
     <div className="member-avatar">{member.name[0]?.toUpperCase()}</div>
     <div className="member-info"><strong>{member.name}</strong><span>{member.email}</span></div>
     {workspace.role==='owner'&&member.role!=='owner'?<>
      <select className="role-select" aria-label={'Role for '+member.name} value={member.role}
       onChange={e=>void setMemberRole(member,e.target.value as 'admin'|'member')}>
       <option value="member">Member</option><option value="admin">Admin</option></select>
      <button className="icon-button danger" title={'Remove '+member.name} onClick={()=>void removeMember(member)}><Trash2 size={17}/></button>
     </>:<span className="role-pill">{member.role}</span>}</div>):
     <p className="muted panel-note">Only workspace administrators can view and invite members.</p>}
   </div>
  </div>
  {isAdmin&&<div className="setting-grid">
   <section className="settings-panel setting-card">
    <div className="card-heading"><Github size={21}/><h3>Fresh Teacher downloads</h3></div>
    <p className="muted">Choose whether NexDrive downloads reusable files or only catalogs repository links.</p>
    <form onSubmit={saveFreshMode}>
     <label>Repository policy<select value={freshMode} onChange={e=>setFreshMode(e.target.value as 'licensed_downloads'|'all_downloads')}>
      <option value="licensed_downloads">Licensed repositories — download files</option>
      <option value="all_downloads">All repositories — download files</option>
     </select></label>
     <p className="muted">All-repositories mode is for content you own or are authorised to redistribute. Files remain EduShare drafts.</p>
     <button className="primary" type="submit"><Check size={17}/> Save download policy</button>
    </form>
   </section>
   <section className="settings-panel setting-card">
    <div className="card-heading"><UserPlus size={21}/><h3>Invite a teammate</h3></div>
    <p className="muted">Create a private invitation that expires in 7 days.</p>
    <form onSubmit={invite}>
     <label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="teammate@example.com"/></label>
     <label>Access level<select value={role} onChange={e=>setRole(e.target.value as 'member'|'admin')}>
      <option value="member">Member — manage files</option><option value="admin">Admin — manage access too</option></select></label>
     <button className="primary" type="submit"><Plus size={17}/> Create invite link</button>
    </form>
    {inviteUrl&&<div className="secret-box"><span>{inviteUrl}</span><button title="Copy invitation" onClick={()=>void copy(inviteUrl)}><Copy size={17}/></button></div>}
   </section>
   <section className="settings-panel setting-card">
    <div className="card-heading"><KeyRound size={21}/><h3>Connect an application</h3></div>
    <p className="muted">Use server-side API keys for Ledgerly or other trusted apps.</p>
    <form onSubmit={createKey}>
     <label>Application name<input required value={keyName} onChange={e=>setKeyName(e.target.value)} placeholder="e.g. Ledgerly"/></label>
     <label>Access level<select value={permission} onChange={e=>setPermission(e.target.value as 'read'|'write')}>
      <option value="read">Read only</option><option value="write">Read & write</option></select></label>
     <button className="primary" type="submit"><Plus size={17}/> Generate API key</button>
    </form>
    {secret&&<div className="secret-alert"><div><Info size={16}/> Save this key now. You cannot retrieve it again.</div>
     <div className="secret-box"><span>{secret}</span><button title="Copy key" onClick={()=>void copy(secret)}><Copy size={17}/></button></div></div>}
   </section>
  </div>}
  {isAdmin&&<section className="setting-section">
   <div className="section-heading"><div className="section-icon"><ShieldCheck size={22}/></div>
    <div><h2>Active API keys</h2><p>Revoke access to any connected application instantly.</p></div></div>
   <div className="settings-panel">
    {!keys.length?<p className="muted panel-note">No applications connected yet.</p>:
     keys.map(k=><div className="member-row" key={k.id}><span className="member-avatar key-avatar"><KeyRound size={19}/></span>
      <div className="member-info"><strong>{k.name}</strong><span>{k.permission} access · Created {new Date(k.created_at).toLocaleDateString()}</span></div>
      <button className="icon-button danger" title="Revoke API key" onClick={()=>void revoke(k.id)}><Trash2 size={18}/></button>
     </div>)}
   </div>
  </section>}
  {isAdmin&&<section className="setting-section">
   <div className="section-heading"><div className="section-icon"><ShieldCheck size={22}/></div>
    <div><h2>Recent activity</h2><p>Workspace actions recorded for administrators.</p></div></div>
   <div className="settings-panel">
    {activity.length===0?<p className="muted panel-note">No recorded actions yet.</p>:
     activity.slice(0,25).map(event=><div className="activity-row" key={event.id}>
      <span className="activity-dot"/><span>{event.action.replaceAll('.',' · ').replaceAll('_',' ')}</span>
      <time>{new Date(event.created_at).toLocaleString()}</time></div>)}
   </div>
  </section>}
  <AccountSecurity/>
 </div>;
}
