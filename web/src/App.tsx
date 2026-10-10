import {useEffect,useState} from 'react';
import {Cloud,Plus,LogOut,ChevronDown,Users,HardDrive,Settings as Gear} from 'lucide-react';
import {api,type Profile} from './api';
import Auth from './components/Auth';
import Drive from './components/Drive';
import Settings from './components/Settings';
export default function App(){
 const [invite,setInvite]=useState<string|null>(()=>new URLSearchParams(window.location.search).get('invite'));
 const [profile,setProfile]=useState<Profile|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const [workspaceId,setWorkspaceId]=useState('');
 const [page,setPage]=useState<'drive'|'settings'>('drive');
 async function refresh(){
  try{const data=await api<Profile>('/auth/me');setProfile(data);
   setWorkspaceId(old=>data.workspaces.some(w=>w.id===old)?old:(data.workspaces[0]?.id||''));
  }catch{setProfile(null);}finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[]);
 async function finishAuth(){
  if(invite){history.replaceState({},'',location.pathname);setInvite(null);}
  await refresh();
 }
 async function logout(){
  await api('/auth/logout',{method:'POST'});setProfile(null);setWorkspaceId('');
 }
 async function createWorkspace(){
  const name=window.prompt('New workspace name');if(!name?.trim())return;
  try{await api('/workspaces',{method:'POST',json:{name:name.trim()}});await refresh();}
  catch(e){setError((e as Error).message);}
 }
 async function acceptInvite(){
  if(!invite)return;
  try{await api('/invitations/accept',{method:'POST',json:{token:invite}});
   history.replaceState({},'',location.pathname);setInvite(null);await refresh();setError('');}
  catch(e){setError((e as Error).message);}
 }
 if(loading)return <div className="loading-screen"><Cloud size={38}/><h2>NexDrive</h2><p>Opening your workspace…</p></div>;
 if(!profile)return <Auth onAuthenticated={()=>void finishAuth()} invite={invite}/>;
 const workspace=profile.workspaces.find(w=>w.id===workspaceId);
 return <div className="app-shell">
  <aside className="sidebar">
   <div className="brand"><span className="logo-mark"><Cloud size={24}/></span><strong>NexDrive</strong></div>
   <div className="side-label">WORKSPACE</div>
   <div className="workspace-switcher"><select aria-label="Workspace" value={workspaceId} onChange={e=>{setWorkspaceId(e.target.value);setPage('drive');}}>
    {profile.workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
   </select><ChevronDown size={16}/></div>
   <nav className="main-nav">
    <button className={page==='drive'?'active':''} onClick={()=>setPage('drive')}><HardDrive size={19}/> My files</button>
    <button className={page==='settings'?'active':''} onClick={()=>setPage('settings')}><Gear size={19}/> Settings & access</button>
   </nav>
   <div className="sidebar-bottom">
    <button className="new-workspace" onClick={createWorkspace}><Plus size={17}/> New workspace</button>
    <div className="side-profile"><span className="avatar">{profile.user.name[0]?.toUpperCase()}</span>
      <div className="profile-meta"><strong>{profile.user.name}</strong><span>{profile.user.email}</span></div>
      <button aria-label="Sign out" title="Sign out" onClick={()=>void logout()}><LogOut size={17}/></button>
    </div>
   </div>
  </aside>
  <main className="content">
   <header className="mobile-header"><span className="logo-mark"><Cloud size={21}/></span><strong>NexDrive</strong>
    <select aria-label="Mobile workspace" value={workspaceId} onChange={e=>{setWorkspaceId(e.target.value);setPage("drive");}}>{profile.workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
    <select aria-label="Mobile page" value={page} onChange={e=>setPage(e.target.value as 'drive'|'settings')}><option value="drive">Files</option><option value="settings">Settings</option></select></header>
   {invite&&<div className="invite-banner"><Users size={18}/> You have a pending workspace invitation. <button onClick={()=>void acceptInvite()}>Accept invitation</button></div>}
   {error&&<div className="alert error" role="alert">{error}<button onClick={()=>setError('')}>×</button></div>}
   {workspace?(page==='drive'?<Drive key={workspace.id} workspace={workspace}/>:<Settings key={workspace.id} workspace={workspace}/>):
    <div className="empty-state"><h2>No workspace yet</h2><p>Create a workspace or accept an invitation to begin.</p>
    <button className="primary" onClick={createWorkspace}><Plus size={18}/> Create workspace</button></div>}
  </main>
 </div>;
}
