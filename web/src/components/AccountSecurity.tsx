import {useEffect,useState} from 'react';
import {LogOut,ShieldCheck} from 'lucide-react';
import {api} from '../api';
type Session={id:string;created_at:string;expires_at:string};
export default function AccountSecurity(){
 const [sessions,setSessions]=useState<Session[]>([]);
 const [error,setError]=useState('');
 const [working,setWorking]=useState(false);
 useEffect(()=>{void api<{sessions:Session[]}>('/auth/sessions').then(result=>
  setSessions(result.sessions)).catch(e=>setError((e as Error).message));},[]);
 async function signOutEverywhere(){
  if(!window.confirm('Sign out from all devices? You will need to sign in again.'))return;
  setWorking(true);
  try{
   await api('/auth/logout-all',{method:'POST'});
   window.location.assign('/');
  }catch(e){setError((e as Error).message);setWorking(false);}
 }
 return <section className="setting-section">
  <div className="section-heading"><div className="section-icon"><ShieldCheck size={22}/></div>
   <div><h2>Account security</h2><p>Manage sessions signed in to your account.</p></div></div>
  <div className="settings-panel setting-card">
   <p className="muted">{sessions.length} active session{sessions.length===1?'':'s'}.
    You can revoke all sessions if a device is lost.</p>
   {error&&<div className="alert error">{error}</div>}
   <button className="outline" disabled={working} onClick={()=>void signOutEverywhere()}>
    <LogOut size={17}/> Sign out on every device</button>
  </div>
 </section>;
}
