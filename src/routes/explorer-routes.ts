import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {pool} from '../db.js';
import {audit} from '../audit.js';
import {bad,requireUser} from '../auth.js';
import {scope,node,uuid} from './util.js';

export const explorerRoutes:FastifyPluginAsync=async app=>{
 app.get('/workspaces/:wid/recent',async req=>{
  const {wid}=await scope(req);
  const r=await pool.query(
   "SELECT id,parent_id,kind,name,size_bytes,mime_type,version_number,updated_at,created_at FROM nodes WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100",
   [wid]);
  return {nodes:r.rows};
 });
 app.get('/workspaces/:wid/starred',async req=>{
  const {wid,principal}=await scope(req);
  requireUser(principal);
  const r=await pool.query(
   "SELECT n.id,n.parent_id,n.kind,n.name,n.size_bytes,n.mime_type,n.version_number,n.updated_at FROM favorites f JOIN nodes n ON n.id=f.node_id AND n.workspace_id=f.workspace_id WHERE f.workspace_id=$1 AND f.user_id=$2 AND n.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 200",
   [wid,principal.id]);
  return {nodes:r.rows};
 });
 app.post('/workspaces/:wid/nodes/:id/star',async req=>{
  const {wid,principal}=await scope(req);
  requireUser(principal);
  const {id}=z.object({id:uuid}).parse(req.params);
  await node(wid,id);
  await pool.query('INSERT INTO favorites(workspace_id,user_id,node_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
   [wid,principal.id,id]);
  return {starred:true};
 });
 app.delete('/workspaces/:wid/nodes/:id/star',async req=>{
  const {wid,principal}=await scope(req);
  requireUser(principal);
  const {id}=z.object({id:uuid}).parse(req.params);
  await pool.query('DELETE FROM favorites WHERE workspace_id=$1 AND user_id=$2 AND node_id=$3',
   [wid,principal.id,id]);
  return {starred:false};
 });
 app.get('/workspaces/:wid/activity',async req=>{
  const {wid}=await scope(req,'admin');
  const {cursor}=z.object({cursor:z.coerce.number().int().nonnegative().default(0)})
   .parse(req.query);
  if(cursor>10000)throw bad('Offset too large');
  const r=await pool.query(
   'SELECT id,action,target_node_id,details,actor_user_id,actor_key_id,created_at FROM audit_events WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET $2',
   [wid,cursor]);
  return {events:r.rows,nextCursor:r.rows.length===100?cursor+100:null};
 });
};
