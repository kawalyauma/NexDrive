import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from '../db.js';
import {bad,newId,digest,newOpaqueToken,publicOrigin} from '../auth.js';
import {streamBlob,downloadName} from '../storage.js';
import {scope,node,uuid} from './util.js';
export async function registerNodeShares(app:FastifyInstance){
 app.post('/workspaces/:wid/nodes/:id/shares',async req=>{
  const {wid,principal}=await scope(req,'write');
  const {id}=z.object({id:uuid}).parse(req.params);
  const item=await node(wid,id);
  if(item.kind!=='file')throw bad('Only files can be shared');
  const {days}=z.object({days:z.number().int().min(1).max(30).default(7)}).parse(req.body||{});
  const token=newOpaqueToken();
  await pool.query(
   "INSERT INTO shares(id,workspace_id,node_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,now()+($5::int * interval '1 day'),$6)",
   [newId(),wid,id,digest(token),days,principal?.type==='user'?principal.id:null]);
  return {url:publicOrigin+'/api/shares/'+token,expiresInDays:days};
 });
 app.get('/shares/:token',async(req,reply)=>{
  const {token}=z.object({token:z.string().min(30).max(128)}).parse(req.params);
  const item=(await pool.query(
   "SELECT n.* FROM shares s JOIN nodes n ON n.id=s.node_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND n.deleted_at IS NULL",
   [digest(token)])).rows[0];
  if(!item)throw bad('Link expired or invalid',404);
  return reply.header('Content-Disposition',downloadName(item.name))
   .header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff')
   .type('application/octet-stream').send(streamBlob(item.blob_key));
 });
}
