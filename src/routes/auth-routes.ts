import type {FastifyPluginAsync} from 'fastify';
import argon2 from 'argon2';
import {z} from 'zod';
import {pool,transaction} from '../db.js';
import {bad,digest,newId,requireUser,resolvePrincipal,setSession} from '../auth.js';
import {defaultQuotaBytes} from '../storage.js';

const registerSchema=z.object({
 name:z.string().trim().min(1).max(120),
 email:z.string().trim().email().max(254).transform(x=>x.toLowerCase()),
 password:z.string().min(12).max(256),
 workspaceName:z.string().trim().min(1).max(120).optional(),
 inviteToken:z.string().optional()
});
export const authRoutes:FastifyPluginAsync=async app=>{
 app.post('/auth/register',async(req,reply)=>{
  const form=registerSchema.parse(req.body);
  const passwordHash=await argon2.hash(form.password,{type:argon2.argon2id});
  const id=newId();
  await transaction(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(7428921)');
   const existing=await db.query('SELECT id FROM users LIMIT 1');
   let invite;
   if(form.inviteToken){
    invite=(await db.query(
     'SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE',
     [digest(form.inviteToken)])).rows[0];
    if(!invite||invite.email!==form.email)throw bad('Invalid invitation',403);
   }else if(existing.rowCount && process.env.ALLOW_SIGNUP!=='true'){
    throw bad('Registration requires an invitation',403);
   }
   await db.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',
    [id,form.name,form.email,passwordHash]);
   if(invite){
    await db.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)',
     [invite.workspace_id,id,invite.role]);
    await db.query('UPDATE invitations SET accepted_at=now() WHERE id=$1',[invite.id]);
   }else{
    const wid=newId();
    await db.query('INSERT INTO workspaces(id,name,owner_id,quota_bytes) VALUES($1,$2,$3,$4)',
     [wid,form.workspaceName||form.name+' Drive',id,defaultQuotaBytes]);
    await db.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)',
     [wid,id,'owner']);
   }
  });
  await setSession(reply,id);
  return reply.code(201).send({id,name:form.name,email:form.email});
 });
 app.post('/auth/login',async(req,reply)=>{
  const form=z.object({email:z.string().email(),password:z.string()}).parse(req.body);
  const user=(await pool.query('SELECT * FROM users WHERE email=$1',[form.email.toLowerCase()])).rows[0];
  if(!user||!(await argon2.verify(user.password_hash,form.password)))throw bad('Invalid login',401);
  await setSession(reply,user.id);
  return {id:user.id,name:user.name,email:user.email};
 });
 app.post('/auth/logout',async(_req,reply)=>{
  reply.clearCookie('nexdrive_session',{path:'/'});
  return {ok:true};
 });
 app.get('/auth/me',async(req)=>{
  const p=await resolvePrincipal(req);requireUser(p);
  const result=await pool.query('SELECT id,name,email FROM users WHERE id=$1',[p.id]);
  const spaces=await pool.query(
   'SELECT w.id,w.name,w.quota_bytes,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at',
   [p.id]);
  return {user:result.rows[0],workspaces:spaces.rows};
 });
 app.post('/workspaces',async(req,reply)=>{
  const p=await resolvePrincipal(req);requireUser(p);
  const {name}=z.object({name:z.string().trim().min(1).max(120)}).parse(req.body);
  const id=newId();
  await transaction(async db=>{
   await db.query('INSERT INTO workspaces(id,name,owner_id,quota_bytes) VALUES($1,$2,$3,$4)',
    [id,name,p.id,defaultQuotaBytes]);
   await db.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)',
    [id,p.id,'owner']);
  });
  return reply.code(201).send({id,name});
 });
 app.post('/invitations/accept',async(req)=>{
  const p=await resolvePrincipal(req);requireUser(p);
  const {token}=z.object({token:z.string().min(12)}).parse(req.body);
  return transaction(async db=>{
   const invite=(await db.query(
    'SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE',
    [digest(token)])).rows[0];
   if(!invite||invite.email!==p.email)throw bad('Invalid invitation',403);
   await db.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [invite.workspace_id,p.id,invite.role]);
   await db.query('UPDATE invitations SET accepted_at=now() WHERE id=$1',[invite.id]);
   return {ok:true,workspaceId:invite.workspace_id};
  });
 });
};
