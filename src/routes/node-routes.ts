import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {pool,transaction} from '../db.js';
import {bad,newId} from '../auth.js';
import {safeFileName,saveUpload,removeBlob,maxUploadBytes,streamBlob,downloadName} from '../storage.js';
import {scope,folder,node,uuid} from './util.js';
import {registerNodeMutations} from './node-mutations.js';
export const nodeRoutes:FastifyPluginAsync=async app=>{
 app.get('/workspaces/:wid/nodes',async req=>{
  const {wid}=await scope(req);
  const input=z.object({parentId:uuid.optional(),q:z.string().max(200).optional(),
   trash:z.enum(['true','false']).optional()}).parse(req.query);
  if(input.q){
   const r=await pool.query(
    "SELECT id,parent_id,kind,name,size_bytes,mime_type FROM nodes WHERE workspace_id=$1 AND deleted_at IS NULL AND name ILIKE $2 ORDER BY kind,name LIMIT 200",
    [wid,'%'+input.q+'%']);
   return {nodes:r.rows};
  }
  if(input.trash==='true'){
   const r=await pool.query(
    "SELECT n.id,n.parent_id,n.kind,n.name,n.size_bytes,n.deleted_at FROM nodes n LEFT JOIN nodes p ON p.id=n.parent_id WHERE n.workspace_id=$1 AND n.deleted_at IS NOT NULL AND (n.parent_id IS NULL OR p.deleted_at IS NULL) ORDER BY n.deleted_at DESC LIMIT 200",
    [wid]);return {nodes:r.rows};
  }
  await folder(wid,input.parentId||null);
  const r=await pool.query(
   'SELECT id,parent_id,kind,name,size_bytes,mime_type,created_at FROM nodes WHERE workspace_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND deleted_at IS NULL ORDER BY kind,lower(name) LIMIT 200',
   [wid,input.parentId||null]);
  return {nodes:r.rows};
 });
 app.post('/workspaces/:wid/folders',async(req,reply)=>{
  const {wid,principal}=await scope(req,'write');
  const form=z.object({name:z.string(),parentId:uuid.nullish()}).parse(req.body);
  await folder(wid,form.parentId||null);
  const r=await pool.query(
   "INSERT INTO nodes(id,workspace_id,parent_id,created_by,kind,name) VALUES($1,$2,$3,$4,'folder',$5) RETURNING id,name",
   [newId(),wid,form.parentId||null,principal?.type==='user'?principal.id:null,safeFileName(form.name)]);
  return reply.code(201).send(r.rows[0]);
 });
 app.post('/workspaces/:wid/upload',async(req,reply)=>{
  const {wid,principal}=await scope(req,'write');
  const {parentId}=z.object({parentId:uuid.optional()}).parse(req.query);
  await folder(wid,parentId||null);
  const part=await req.file({limits:{fileSize:maxUploadBytes,files:1}});
  if(!part)throw bad('File required');
  const filename=safeFileName(part.filename);
  const saved=await saveUpload(part,wid),id=newId();
  try{
   await transaction(async db=>{
    const ws=(await db.query('SELECT quota_bytes FROM workspaces WHERE id=$1 FOR UPDATE',[wid])).rows[0];
    const used=(await db.query("SELECT coalesce(sum(size_bytes),0)::text AS used FROM nodes WHERE workspace_id=$1 AND kind='file'",[wid])).rows[0].used;
    if(BigInt(used)+BigInt(saved.size)>BigInt(ws.quota_bytes))throw bad('Workspace storage quota exceeded',413);
    await db.query(
     "INSERT INTO nodes(id,workspace_id,parent_id,created_by,kind,name,blob_key,size_bytes,mime_type) VALUES($1,$2,$3,$4,'file',$5,$6,$7,$8)",
     [id,wid,parentId||null,principal?.type==='user'?principal.id:null,filename,saved.blobKey,saved.size,
      (part.mimetype||'application/octet-stream').slice(0,180)]);
   });
   return reply.code(201).send({id,name:filename,size_bytes:saved.size});
  }catch(err){await removeBlob(saved.blobKey).catch(()=>{});throw err;}
 });
 await registerNodeMutations(app);
};
