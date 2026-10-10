import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool,transaction} from '../db.js';
import {bad} from '../auth.js';
import {removeBlob} from '../storage.js';
import {scope,folder,node,uuid} from './util.js';
import {audit} from '../audit.js';
export async function registerNodeTrash(app:FastifyInstance){
 app.post('/workspaces/:wid/nodes/:id/trash',async req=>{
  const {wid,principal}=await scope(req,'write');
  const {id}=z.object({id:uuid}).parse(req.params);
  await node(wid,id);
  await pool.query(
   'WITH RECURSIVE tree AS (SELECT id FROM nodes WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT n.id FROM nodes n JOIN tree t ON n.parent_id=t.id WHERE n.workspace_id=$2) UPDATE nodes SET deleted_at=now() WHERE id IN (SELECT id FROM tree) AND deleted_at IS NULL',
   [id,wid]);
  await audit(wid,principal,'node.trashed',id);
  return {ok:true};
 });
 app.post('/workspaces/:wid/nodes/:id/restore',async req=>{
  const {wid,principal}=await scope(req,'write');
  const {id}=z.object({id:uuid}).parse(req.params);
  const item=await node(wid,id,true);
  if(!item.deleted_at)throw bad('Item is not in trash');
  if(item.parent_id)await folder(wid,item.parent_id);
  await pool.query(
   'WITH RECURSIVE tree AS (SELECT id FROM nodes WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT n.id FROM nodes n JOIN tree t ON n.parent_id=t.id WHERE n.workspace_id=$2) UPDATE nodes SET deleted_at=NULL WHERE id IN (SELECT id FROM tree) AND deleted_at=$3',
   [id,wid,item.deleted_at]);
  await audit(wid,principal,'node.restored',id);
  return {ok:true};
 });
 app.delete('/workspaces/:wid/nodes/:id',async req=>{
  const {wid,principal}=await scope(req,'write');
  const {id}=z.object({id:uuid}).parse(req.params);
  const item=await node(wid,id,true);
  if(!item.deleted_at)throw bad('Move to trash first');
  const files=await transaction(async db=>{
   const r=await db.query(
    "WITH RECURSIVE tree AS (SELECT id FROM nodes WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT n.id FROM nodes n JOIN tree t ON n.parent_id=t.id WHERE n.workspace_id=$2) SELECT blob_key FROM nodes WHERE id IN (SELECT id FROM tree) AND kind='file'",
    [id,wid]);
   const versions=await db.query('SELECT blob_key FROM file_versions WHERE node_id IN (WITH RECURSIVE tree AS (SELECT id FROM nodes WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT n.id FROM nodes n JOIN tree t ON n.parent_id=t.id WHERE n.workspace_id=$2) SELECT id FROM tree)',[id,wid]);
   r.rows.push(...versions.rows);
   await db.query('DELETE FROM nodes WHERE id=$1 AND workspace_id=$2',[id,wid]);
   return r.rows as {blob_key:string}[];
  });
  for(const file of files)await removeBlob(file.blob_key).catch(err=>app.log.error(err));
  await audit(wid,principal,'node.deleted_permanently',id,{blobCount:files.length});
  return {ok:true};
 });
}
