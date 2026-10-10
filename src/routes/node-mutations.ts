import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from '../db.js';
import {bad} from '../auth.js';
import {safeFileName,streamBlob,downloadName} from '../storage.js';
import {scope,folder,node,uuid} from './util.js';
import {registerNodeTrash} from './node-trash.js';
import {registerNodeShares} from './node-shares.js';
export async function registerNodeMutations(app:FastifyInstance){
 app.get('/workspaces/:wid/nodes/:id/download',async(req,reply)=>{
  const {wid}=await scope(req);
  const {id}=z.object({id:uuid}).parse(req.params);
  const item=await node(wid,id);
  if(item.kind!=='file')throw bad('Not a file');
  return reply.header('Content-Disposition',downloadName(item.name))
   .header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store')
   .type('application/octet-stream').send(streamBlob(item.blob_key));
 });
 app.patch('/workspaces/:wid/nodes/:id',async req=>{
  const {wid}=await scope(req,'write');
  const {id}=z.object({id:uuid}).parse(req.params);
  const input=z.object({name:z.string().optional(),parentId:uuid.nullable().optional()}).parse(req.body);
  if(input.name===undefined&&input.parentId===undefined)throw bad('Nothing to update');
  const item=await node(wid,id);
  let parent=item.parent_id;
  if(input.parentId!==undefined){
   parent=input.parentId;
   await folder(wid,parent);
   if(item.kind==='folder'&&parent){
    const r=await pool.query(
     'WITH RECURSIVE t AS (SELECT id FROM nodes WHERE id=$1 UNION ALL SELECT n.id FROM nodes n JOIN t ON n.parent_id=t.id) SELECT 1 FROM t WHERE id=$2',
     [id,parent]);
    if(r.rowCount)throw bad('Cannot move a folder into itself');
   }
  }
  const filename=input.name===undefined?item.name:safeFileName(input.name);
  const r=await pool.query(
   'UPDATE nodes SET name=$1,parent_id=$2,updated_at=now() WHERE id=$3 AND workspace_id=$4 AND deleted_at IS NULL RETURNING id,name,parent_id',
   [filename,parent,id,wid]);
  return r.rows[0];
 });
 await registerNodeTrash(app);
 await registerNodeShares(app);
}
