import type {PoolClient,Pool} from 'pg';
import {newId,type Principal} from './auth.js';
import {pool} from './db.js';
export async function audit(
  workspaceId:string,
  actor:Principal|null,
  action:string,
  targetNodeId:string|null=null,
  details:Record<string,unknown>={},
  db:PoolClient|Pool=pool
):Promise<void>{
 await db.query(
  'INSERT INTO audit_events(id,workspace_id,actor_user_id,actor_key_id,action,target_node_id,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
  [newId(),workspaceId,actor?.type==='user'?actor.id:null,actor?.type==='app'?actor.id:null,
   action,targetNodeId,JSON.stringify(details)]
 );
}
