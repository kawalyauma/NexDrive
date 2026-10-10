import {useState} from 'react';
import {ArrowRight,Cloud,LockKeyhole,FolderClosed,ShieldCheck} from 'lucide-react';
import {api} from '../api';
type Props={onAuthenticated:()=>void;invite:string|null};
export default function Auth({onAuthenticated,invite}:Props){
 const [register,setRegister]=useState(Boolean(invite));
 const [name,setName]=useState(''),[email,setEmail]=useState('');
 const [password,setPassword]=useState(''),[error,setError]=useState('');
 const [bootstrapToken,setBootstrapToken]=useState('');
 const [busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent){
  e.preventDefault();setError('');setBusy(true);
  try{
   if(register)await api('/auth/register',{method:'POST',
    json:{name,email,password,inviteToken:invite||undefined,bootstrapToken:bootstrapToken||undefined}});
   else{
    await api('/auth/login',{method:'POST',json:{email,password}});
    if(invite)await api('/invitations/accept',{method:'POST',json:{token:invite}});
   }
   onAuthenticated();
  }catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 return <div className="auth-layout">
  <section className="auth-feature">
   <div className="auth-brand"><div className="logo-mark"><Cloud size={25}/></div><strong>NexDrive</strong></div>
   <div className="hero-copy"><span className="eyebrow light">YOUR SPACE, YOUR WAY</span>
    <h1>Everything you need.<br/><em>All in one place.</em></h1>
    <p>Your documents, photos and projects—organized, protected and ready wherever you work.</p>
    <div className="auth-benefits"><span><ShieldCheck size={18}/> Private by default</span>
     <span><FolderClosed size={18}/> Beautifully organized</span></div>
   </div><div className="hero-deco deco-one"/><div className="hero-deco deco-two"/>
   <div className="auth-bottom">NEXDRIVE · SELF-HOSTED STORAGE</div>
  </section>
  <section className="auth-form-side">
   <div className="auth-form-wrap"><div className="auth-lock"><LockKeyhole size={22}/></div>
    <div className="eyebrow">WELCOME TO NEXDRIVE</div>
    <h2>{register?'Create your account':'Welcome back'}</h2>
    <p className="muted">{invite?'You have been invited to join a workspace.':register?'Start with a private workspace of your own.':'Sign in to access your workspace.'}</p>
    <form onSubmit={submit}>
     {register&&<label>Full name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></label>}
     <label>Email address<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
     <label>Password<input required type="password" minLength={register?12:1} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password"/></label>
     {register&&!invite&&<label>Initial setup token (first user only)<input type="password" value={bootstrapToken} onChange={e=>setBootstrapToken(e.target.value)} placeholder="From your server .env"/></label>}
     {register&&<small className="muted">Use at least 12 characters for your password. On a new server, enter its setup token.</small>}
     {error&&<div className="alert error" role="alert">{error}</div>}
     <button className="primary full" disabled={busy}>{busy?'Please wait…':register?'Create account':'Sign in'} <ArrowRight size={17}/></button>
    </form>
    <div className="auth-switch">{register?'Already have an account?':'New to NexDrive?'}{' '}
     <button className="text-button" onClick={()=>{setRegister(!register);setError('');}}>{register?'Sign in':'Create an account'}</button>
    </div>
   </div>
  </section>
 </div>;
}
