import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {pool} from '../db.js';
import {bad,newId,digest,newOpaqueToken,publicOrigin,requireUser} from '../auth.js';
import {scope,uuid} from './util.js';
export const managementRoutes:FastifyPluginAsync=async app=>{
 app.get('/workspaces/:wid/usage',async req=>{
  const {wid}=await scope(req);
  const ws=(await pool.query('SELECT name,quota_bytes FROM workspaces WHERE id=$1',[wid])).rows[0];
  const used=(await pool.query(
   "SELECT coalesce(sum(size_bytes),0)::text AS used FROM nodes WHERE workspace_id=$1 AND kind='file'",
   [wid])).rows[0].used;
  return {name:ws.name,quotaBytes:String(ws.quota_bytes),usedBytes:used};
 });
 app.get('/workspaces/:wid/members',async req=>{
  const {wid}=await scope(req,'admin');
  const r=await pool.query(
   'SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.role,u.name',
   [wid]);
  return {members:r.rows};
 });
 app.post('/workspaces/:wid/invitations',async(req,reply)=>{
  const {wid,principal}=await scope(req,'admin');
  requireUser(principal);
  const {email,role}=z.object({
   email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),
   role:z.enum(['admin','member']).default('member')
  }).parse(req.body);
  const token=newOpaqueToken(),id=newId();
  await pool.query(
   "INSERT INTO invitations(id,workspace_id,email,role,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days')",
   [id,wid,email,role,digest(token),principal.id]);
  return reply.code(201).send({url:publicOrigin+'/?invite='+encodeURIComponent(token),
   expiresInDays:7,email,role});
 });
 app.get('/workspaces/:wid/api-keys',async req=>{
  const {wid}=await scope(req,'admin');
  const r=await pool.query(
   'SELECT id,name,permission,created_at,last_used_at FROM api_keys WHERE workspace_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC',
   [wid]);
  return {keys:r.rows};
 });
 app.post('/workspaces/:wid/api-keys',async(req,reply)=>{
  const {wid,principal}=await scope(req,'admin');
  requireUser(principal);
  const {name,permission}=z.object({name:z.string().trim().min(1).max(100),
   permission:z.enum(['read','write']).default('read')}).parse(req.body);
  const token=newOpaqueToken('nd_'),id=newId();
  await pool.query(
   'INSERT INTO api_keys(id,workspace_id,name,permission,key_hash,created_by) VALUES($1,$2,$3,$4,$5,$6)',
   [id,wid,name,permission,digest(token),principal.id]);
  return reply.code(201).send({id,name,permission,token});
 });
 app.delete('/workspaces/:wid/api-keys/:id',async req=>{
  const {wid}=await scope(req,'admin');
  const {id}=z.object({id:uuid}).parse(req.params);
  const r=await pool.query(
   'UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND workspace_id=$2 AND revoked_at IS NULL RETURNING id',
   [id,wid]);
  if(!r.rowCount)throw bad('API key not found',404);
  return {ok:true};
 });
};
