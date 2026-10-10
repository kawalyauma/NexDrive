import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from '../db.js';
import {bad} from '../auth.js';
import {audit} from '../audit.js';
import {safeFileName,streamBlob,blobPath,downloadName} from '../storage.js';
import {stat} from 'node:fs/promises';
import {scope,folder,node,uuid} from './util.js';
import {registerNodeTrash} from './node-trash.js';
import {registerNodeShares} from './node-shares.js';
export async function registerNodeMutations(app:FastifyInstance){
 const download=async(req:Parameters<typeof scope>[0],reply:any,head=false)=>{
  const {wid}=await scope(req);
  const {id}=z.object({id:uuid}).parse(req.params);
  const item=await node(wid,id);
  if(item.kind!=='file')throw bad('Not a file');
  const size=Number(item.size_bytes)||(await stat(blobPath(item.blob_key))).size;
  const raw=typeof req.headers.range==='string'?req.headers.range:null;
  let start=0,end=size-1,status=200;
  if(raw){
   const match=/^bytes=(\d+)-(\d*)$/.exec(raw);
   if(!match) return reply.code(416).header('Content-Range',`bytes */${size}`).send();
   start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;
   if(start>end||start>=size)return reply.code(416).header('Content-Range',`bytes */${size}`).send();
   status=206;
  }
  reply.header('Content-Disposition',downloadName(item.name))
   .header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store')
   .header('Accept-Ranges','bytes').header('X-File-Size',String(size))
   .header('Content-Length',String(end-start+1)).type(item.mime_type||'application/octet-stream');
  if(status===206)reply.header('Content-Range',`bytes ${start}-${end}/${size}`).code(206);
  if(head)return reply.send();
  return reply.send(streamBlob(item.blob_key,{start,end}));
 };
 app.get('/workspaces/:wid/nodes/:id/download',(req,reply)=>download(req,reply));
 app.patch('/workspaces/:wid/nodes/:id',async req=>{
  const {wid,principal}=await scope(req,'write');
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
  await audit(wid,principal,'node.updated',id,{name:filename,parentId:parent});
  return r.rows[0];
 });
 await registerNodeTrash(app);
 await registerNodeShares(app);
}
