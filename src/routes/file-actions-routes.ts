import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {transaction} from '../db.js';
import {audit} from '../audit.js';
import {bad,newId} from '../auth.js';
import {cloneBlob,removeBlob,safeFileName,streamBlob} from '../storage.js';
import {node,scope,uuid} from './util.js';

const previewMimes=new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf']);

export const fileActionsRoutes:FastifyPluginAsync=async app=>{
 app.get('/workspaces/:wid/nodes/:id/preview',async(req,reply)=>{
  const {wid}=await scope(req);
  const {id}=z.object({id:uuid}).parse(req.params);
  const item=await node(wid,id);
  if(item.kind!=='file')throw bad('Not a file');
  if(!previewMimes.has(item.mime_type))throw bad('Preview unavailable for this file',415);
  return reply.header('Content-Disposition','inline')
   .header('X-Content-Type-Options','nosniff')
   .header('Content-Security-Policy','sandbox')
   .header('Cross-Origin-Resource-Policy','same-origin')
   .header('Cache-Control','private,no-store')
   .type(item.mime_type).send(streamBlob(item.blob_key));
 });
 app.post('/workspaces/:wid/nodes/:id/copy',async(req,reply)=>{
  const {wid,principal}=await scope(req,'write');
  const {id}=z.object({id:uuid}).parse(req.params);
  const form=z.object({name:z.string().optional()}).parse(req.body||{});
  const original=await node(wid,id);
  if(original.kind!=='file')throw bad('Only files can be duplicated',400);
  const newName=safeFileName(form.name||'Copy of '+original.name);
  let cloned:string|undefined;
  try{
   const result=await transaction(async db=>{
    const ws=(await db.query('SELECT quota_bytes FROM workspaces WHERE id=$1 FOR UPDATE',[wid])).rows[0];
    const source=(await db.query(
     "SELECT * FROM nodes WHERE id=$1 AND workspace_id=$2 AND kind='file' AND deleted_at IS NULL FOR SHARE",
     [id,wid])).rows[0];
    if(!source)throw bad('File not found',404);
    const used=(await db.query(
     "SELECT ((SELECT coalesce(sum(size_bytes),0) FROM nodes WHERE workspace_id=$1 AND kind='file')+(SELECT coalesce(sum(size_bytes),0) FROM file_versions WHERE workspace_id=$1))::text AS bytes",
     [wid])).rows[0].bytes;
    if(BigInt(used)+BigInt(source.size_bytes)>BigInt(ws.quota_bytes))
     throw bad('Workspace quota exceeded',413);
    cloned=await cloneBlob(source.blob_key,wid);
    const newIdValue=newId();
    const r=await db.query(
     "INSERT INTO nodes(id,workspace_id,parent_id,created_by,kind,name,blob_key,size_bytes,mime_type) VALUES($1,$2,$3,$4,'file',$5,$6,$7,$8) RETURNING id,name",
     [newIdValue,wid,source.parent_id,principal?.type==='user'?principal.id:null,newName,
      cloned,source.size_bytes,source.mime_type]);
    await audit(wid,principal,'file.copied',newIdValue,{sourceId:id},db);
    return r.rows[0];
   });
   return reply.code(201).send(result);
  }catch(err){if(cloned)await removeBlob(cloned).catch(()=>{});throw err;}
 });
};
