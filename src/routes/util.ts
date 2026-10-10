import {z} from 'zod';
import {pool} from '../db.js';
import {access,bad,resolvePrincipal} from '../auth.js';
import type {FastifyRequest} from 'fastify';
export const uuid=z.string().uuid();
export async function scope(req:FastifyRequest,needed:'read'|'write'|'admin'='read'){
 const {wid}=z.object({wid:uuid}).parse(req.params);
 const principal=await resolvePrincipal(req);
 const role=await access(principal,wid,needed);
 return {wid,principal,role};
}
export async function folder(wid:string,parentId:string|null):Promise<void>{
 if(parentId===null)return;
 const result=await pool.query(
  "SELECT id FROM nodes WHERE id=$1 AND workspace_id=$2 AND kind='folder' AND deleted_at IS NULL",
  [parentId,wid]);
 if(!result.rowCount)throw bad('Parent folder not found',404);
}
export async function node(wid:string,id:string,includeDeleted=false){
 const record=(await pool.query(
  'SELECT * FROM nodes WHERE workspace_id=$1 AND id=$2 AND ($3::boolean OR deleted_at IS NULL)',
  [wid,id,includeDeleted])).rows[0];
 if(!record)throw bad('File or folder not found',404);
 return record;
}
