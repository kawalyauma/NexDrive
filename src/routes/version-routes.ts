import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {pool,transaction} from '../db.js';
import {audit} from '../audit.js';
import {bad,newId} from '../auth.js';
import {saveUpload,removeBlob,cloneBlob,maxUploadBytes,streamBlob,downloadName} from '../storage.js';
import {scope,node,uuid} from './util.js';

const versionNum=z.coerce.number().int().min(1).max(2147483647);
const params=z.object({wid:uuid,id:uuid});
const versionParams=params.extend({version:versionNum});

export const versionRoutes:FastifyPluginAsync=async app=>{
 app.get('/workspaces/:wid/nodes/:id/versions',async req=>{
  const {wid}=await scope(req);
  const {id}=params.parse(req.params);
  const current=await node(wid,id);
  if(current.kind!=='file')throw bad('Not a file');
  const archived=await pool.query(
   'SELECT version_number,size_bytes,mime_type,created_at FROM file_versions WHERE workspace_id=$1 AND node_id=$2 ORDER BY version_number DESC LIMIT 100',
   [wid,id]);
  return {current:{version_number:current.version_number,size_bytes:current.size_bytes,
   mime_type:current.mime_type,created_at:current.updated_at},archived:archived.rows};
 });
 app.get('/workspaces/:wid/nodes/:id/versions/:version/download',async(req,reply)=>{
  const {wid}=await scope(req);
  const {id,version}=versionParams.parse(req.params);
  const current=await node(wid,id);
  if(current.kind!=='file')throw bad('Not a file');
  const record=Number(current.version_number)===version?current:
   (await pool.query('SELECT blob_key FROM file_versions WHERE workspace_id=$1 AND node_id=$2 AND version_number=$3',
   [wid,id,version])).rows[0];
  if(!record)throw bad('Version not found',404);
  return reply.header('Content-Disposition',downloadName(current.name))
   .header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff')
   .type('application/octet-stream').send(streamBlob(record.blob_key));
 });
 app.post('/workspaces/:wid/nodes/:id/versions',async(req,reply)=>{
  const {wid,principal}=await scope(req,'write');
  const {id}=params.parse(req.params);
  const current=await node(wid,id);
  if(current.kind!=='file')throw bad('Not a file');
  const part=await req.file({limits:{fileSize:maxUploadBytes,files:1}});
  if(!part)throw bad('File required');
  const saved=await saveUpload(part,wid);
  try{
   const result=await transaction(async db=>{
    const ws=(await db.query('SELECT quota_bytes FROM workspaces WHERE id=$1 FOR UPDATE',[wid])).rows[0];
    const record=(await db.query(
     "SELECT * FROM nodes WHERE id=$1 AND workspace_id=$2 AND kind='file' AND deleted_at IS NULL FOR UPDATE",
     [id,wid])).rows[0];
    if(!record)throw bad('File not found',404);
    const usage=(await db.query(
     "SELECT ((SELECT coalesce(sum(size_bytes),0) FROM nodes WHERE workspace_id=$1 AND kind='file')+(SELECT coalesce(sum(size_bytes),0) FROM file_versions WHERE workspace_id=$1))::text AS bytes",
     [wid])).rows[0].bytes;
    if(BigInt(usage)+BigInt(saved.size)>BigInt(ws.quota_bytes))throw bad('Workspace storage quota exceeded',413);
    await db.query(
     'INSERT INTO file_versions(id,workspace_id,node_id,version_number,blob_key,size_bytes,mime_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
     [newId(),wid,id,record.version_number,record.blob_key,record.size_bytes,record.mime_type,
      principal?.type==='user'?principal.id:null]);
    const update=(await db.query(
     'UPDATE nodes SET version_number=version_number+1,blob_key=$1,size_bytes=$2,mime_type=$3,updated_at=now() WHERE id=$4 RETURNING version_number',
     [saved.blobKey,saved.size,(part.mimetype||'application/octet-stream').slice(0,180),id])).rows[0];
    await audit(wid,principal,'file.version_uploaded',id,{version:update.version_number,sizeBytes:saved.size},db);
    return update;
   });
   return reply.code(201).send({id,version:result.version_number});
  }catch(e){await removeBlob(saved.blobKey).catch(()=>{});throw e;}
 });
 app.post('/workspaces/:wid/nodes/:id/versions/:version/restore',async req=>{
  const {wid,principal}=await scope(req,'write');
  const {id,version}=versionParams.parse(req.params);
  let cloneKey:string|undefined;
  try{
   return await transaction(async db=>{
    const ws=(await db.query('SELECT quota_bytes FROM workspaces WHERE id=$1 FOR UPDATE',[wid])).rows[0];
    const record=(await db.query(
     "SELECT * FROM nodes WHERE id=$1 AND workspace_id=$2 AND kind='file' AND deleted_at IS NULL FOR UPDATE",
     [id,wid])).rows[0];
    if(!record)throw bad('File not found',404);
    const old=(await db.query(
     'SELECT * FROM file_versions WHERE node_id=$1 AND workspace_id=$2 AND version_number=$3',
     [id,wid,version])).rows[0];
    if(!old)throw bad('Archived version not found',404);
    const usage=(await db.query(
     "SELECT ((SELECT coalesce(sum(size_bytes),0) FROM nodes WHERE workspace_id=$1 AND kind='file')+(SELECT coalesce(sum(size_bytes),0) FROM file_versions WHERE workspace_id=$1))::text AS bytes",
     [wid])).rows[0].bytes;
    if(BigInt(usage)+BigInt(old.size_bytes)>BigInt(ws.quota_bytes))throw bad('Workspace quota exceeded',413);
    cloneKey=await cloneBlob(old.blob_key,wid);
    await db.query(
     'INSERT INTO file_versions(id,workspace_id,node_id,version_number,blob_key,size_bytes,mime_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
     [newId(),wid,id,record.version_number,record.blob_key,record.size_bytes,record.mime_type,
      principal?.type==='user'?principal.id:null]);
    const updated=(await db.query(
     'UPDATE nodes SET version_number=version_number+1,blob_key=$1,size_bytes=$2,mime_type=$3,updated_at=now() WHERE id=$4 RETURNING version_number',
     [cloneKey,old.size_bytes,old.mime_type,id])).rows[0];
    await audit(wid,principal,'file.version_restored',id,{fromVersion:version,toVersion:updated.version_number},db);
    return {id,version:updated.version_number};
   });
  }catch(err){if(cloneKey)await removeBlob(cloneKey).catch(()=>{});throw err;}
 });
};
