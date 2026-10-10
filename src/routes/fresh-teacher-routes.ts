import type {FastifyPluginAsync} from 'fastify';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,rename,rm} from 'node:fs/promises';
import {dirname,extname} from 'node:path';
import {pool,transaction} from '../db.js';
import {bad,newId} from '../auth.js';
import {blobPath,maxUploadBytes,safeFileName} from '../storage.js';
import {scope} from './util.js';

type Event={event:string;repo?:string;branch?:string;license?:string;commit?:string;path?:string;
 blob_sha?:string;name?:string;size?:number;done?:number;sha256?:string;mime_type?:string;
 local_path?:string;error?:string;seconds?:number};
let watcher:ChildProcessWithoutNullStreams|null=null;
let restartTimer:NodeJS.Timeout|null=null;

function title(name:string){return name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,200)||'Fresh Teacher resource';}
function mime(name:string){return ({'.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.txt':'text/plain'} as Record<string,string>)[extname(name).toLowerCase()]||'application/octet-stream';}

async function ensureFolder(wid:string,parentId:string|null,name:string){
 const clean=safeFileName(name);
 const found=(await pool.query("SELECT id FROM nodes WHERE workspace_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND kind='folder' AND name=$3 AND deleted_at IS NULL",[wid,parentId,clean])).rows[0];
 if(found)return found.id as string;
 const id=newId();
 try{await pool.query("INSERT INTO nodes(id,workspace_id,parent_id,kind,name) VALUES($1,$2,$3,'folder',$4)",[id,wid,parentId,clean]);return id;}
 catch(error:any){if(error?.code==='23505')return (await pool.query("SELECT id FROM nodes WHERE workspace_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND kind='folder' AND name=$3 AND deleted_at IS NULL",[wid,parentId,clean])).rows[0].id;throw error;}
}

async function uniqueName(wid:string,parentId:string,name:string,blobSha:string){
 const clean=safeFileName(name);
 if(!(await pool.query('SELECT 1 FROM nodes WHERE workspace_id=$1 AND parent_id=$2 AND name=$3 AND deleted_at IS NULL',[wid,parentId,clean])).rowCount)return clean;
 const dot=clean.lastIndexOf('.'),suffix=` (GitHub ${blobSha.slice(0,8)})`;
 return safeFileName(dot>0?clean.slice(0,dot)+suffix+clean.slice(dot):clean+suffix);
}

async function adopt(wid:string,event:Event){
 if(!event.local_path||!event.name||!event.sha256||!event.size||!event.repo||!event.blob_sha)throw new Error('Incomplete Fresh Teacher download');
 const duplicate=(await pool.query("SELECT id,name FROM nodes WHERE workspace_id=$1 AND kind='file' AND sha256=$2 AND deleted_at IS NULL LIMIT 1",[wid,event.sha256])).rows[0];
 if(duplicate){await rm(event.local_path,{force:true});return duplicate;}
 const root=await ensureFolder(wid,null,'Fresh Teacher — Licensed Resources');
 const folder=await ensureFolder(wid,root,event.repo);
 const name=await uniqueName(wid,folder,event.name,event.blob_sha),id=newId(),blobKey=wid+'/'+newId(),target=blobPath(blobKey);
 await mkdir(dirname(target),{recursive:true,mode:0o700});await rename(event.local_path,target);
 try{await transaction(async db=>{
  const ws=(await db.query('SELECT quota_bytes FROM workspaces WHERE id=$1 FOR UPDATE',[wid])).rows[0];
  const used=(await db.query("SELECT ((SELECT coalesce(sum(size_bytes),0) FROM nodes WHERE workspace_id=$1 AND kind='file')+(SELECT coalesce(sum(size_bytes),0) FROM file_versions WHERE workspace_id=$1))::text AS used",[wid])).rows[0].used;
  if(BigInt(used)+BigInt(event.size!)>BigInt(ws.quota_bytes))throw bad('Workspace storage quota exceeded',413);
  await db.query("INSERT INTO nodes(id,workspace_id,parent_id,kind,name,blob_key,size_bytes,mime_type,sha256) VALUES($1,$2,$3,'file',$4,$5,$6,$7,$8)",[id,wid,folder,name,blobKey,event.size,mime(event.name!),event.sha256]);
 });return {id,name};}catch(error){await rm(target,{force:true});throw error;}
}

async function post(nodeId:string,event:Event){
 const base=process.env.EDUSHARE_URL?.replace(/\/$/,'')||'',key=process.env.EDUSHARE_INTEGRATION_KEY||'';
 const response=await fetch(base+'/api/integrations/fresh-teacher/resources',{method:'POST',headers:{'content-type':'application/json','x-integration-key':key},body:JSON.stringify({nodeId,repo:event.repo,path:event.path,commit:event.commit,license:event.license,fileName:event.name,sizeBytes:event.size,sha256:event.sha256,title:title(event.name!)})});
 const body=await response.json().catch(()=>({})) as any;
 if(!response.ok)throw new Error(typeof body.error==='string'?body.error:body.error?.message||`EduShare rejected the file (${response.status})`);
 return body;
}

async function runWatcher(wid:string){
 const output=(process.env.STORAGE_DIR||'/data')+'/.fresh-teacher';await mkdir(output,{recursive:true,mode:0o700});
 const child=spawn('python3',['/app/plugins/fresh_teacher_worker.py','--repos',process.env.FRESH_TEACHER_REPOS||'primary:main:MIT,secondary:main:MIT','--output',output,'--max-bytes',String(maxUploadBytes),'--poll-seconds',process.env.FRESH_TEACHER_POLL_SECONDS||'900'],{stdio:['pipe','pipe','pipe']});watcher=child;
 let current:string|null=null;
 const lines=createInterface({input:child.stdout});
 try{for await(const line of lines){
  const event=JSON.parse(line) as Event;if(!event.repo&&event.event!=='idle')continue;
  if(event.event==='repo'){
   const row=(await pool.query("INSERT INTO fresh_teacher_sources(workspace_id,repo,branch,license,status,started_at) VALUES($1,$2,$3,$4,'scanning',now()) ON CONFLICT(workspace_id,repo) DO UPDATE SET branch=$3,license=$4,status='scanning',error=NULL,updated_at=now() RETURNING last_commit",[wid,event.repo,event.branch,event.license])).rows[0];
   child.stdin.write(row.last_commit===event.commit?'unchanged\n':'scan\n');
  }else if(event.event==='candidate'){
   await pool.query('UPDATE fresh_teacher_sources SET scanned=scanned+1,current_file=$3,updated_at=now() WHERE workspace_id=$1 AND repo=$2',[wid,event.repo,event.path]);
   let item=(await pool.query("INSERT INTO fresh_teacher_items(id,workspace_id,repo,path,blob_sha,commit_sha,license,file_name,size_bytes,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'downloading') ON CONFLICT(workspace_id,repo,path,blob_sha) DO NOTHING RETURNING id",[newId(),wid,event.repo,event.path,event.blob_sha,event.commit,event.license,event.name,event.size])).rows[0];
   if(!item){const old=(await pool.query('SELECT * FROM fresh_teacher_items WHERE workspace_id=$1 AND repo=$2 AND path=$3 AND blob_sha=$4',[wid,event.repo,event.path,event.blob_sha])).rows[0];
    if(old.status==='failed'&&!old.node_id){await pool.query("UPDATE fresh_teacher_items SET status='downloading',error=NULL,updated_at=now() WHERE id=$1",[old.id]);item=old;}
    else{child.stdin.write('skip\n');continue;}}
   current=item.id;child.stdin.write('download\n');
  }else if(event.event==='complete'&&current){
   try{const node=await adopt(wid,event);await pool.query("UPDATE fresh_teacher_items SET node_id=$2,sha256=$3,size_bytes=$4,status='stored',updated_at=now() WHERE id=$1",[current,node.id,event.sha256,event.size]);
    await pool.query('UPDATE fresh_teacher_sources SET downloaded=downloaded+1,bytes_downloaded=bytes_downloaded+$3 WHERE workspace_id=$1 AND repo=$2',[wid,event.repo,event.size]);
    const result=await post(node.id,event),status=result.duplicate?'skipped':'posted';
    await pool.query('UPDATE fresh_teacher_items SET status=$2,edushare_resource_id=$3,edushare_slug=$4,error=NULL,updated_at=now() WHERE id=$1',[current,status,result.resource?.id||null,result.resource?.slug||null]);
    await pool.query(`UPDATE fresh_teacher_sources SET ${status}=${status}+1,error=NULL,updated_at=now() WHERE workspace_id=$1 AND repo=$2`,[wid,event.repo]);
   }catch(error){const message=(error as Error).message.slice(0,500);await pool.query("UPDATE fresh_teacher_items SET status='failed',error=$2,updated_at=now() WHERE id=$1",[current,message]);await pool.query("UPDATE fresh_teacher_sources SET failed=failed+1,error=$3,updated_at=now() WHERE workspace_id=$1 AND repo=$2",[wid,event.repo,message]);}
   current=null;child.stdin.write('continue\n');
  }else if(event.event==='repo_complete')await pool.query("UPDATE fresh_teacher_sources SET last_commit=$3,status='watching',current_file=NULL,error=NULL,updated_at=now() WHERE workspace_id=$1 AND repo=$2",[wid,event.repo,event.commit]);
  else if(event.event==='repo_error')await pool.query("UPDATE fresh_teacher_sources SET status='failed',failed=failed+1,error=$3,updated_at=now() WHERE workspace_id=$1 AND repo=$2",[wid,event.repo,event.error]);
  else if(event.event==='idle')await pool.query("UPDATE fresh_teacher_sources SET status='watching',current_file=NULL,updated_at=now() WHERE workspace_id=$1 AND status<>'failed'",[wid]);
 }}finally{if(child.exitCode===null)child.kill('SIGTERM');watcher=null;await rm(output,{recursive:true,force:true}).catch(()=>{});}
}

function supervise(wid:string){if(watcher)return;void runWatcher(wid).catch(async error=>{await pool.query("UPDATE fresh_teacher_sources SET status='failed',error=$2,updated_at=now() WHERE workspace_id=$1",[wid,(error as Error).message.slice(0,500)]).catch(()=>{});}).finally(()=>{restartTimer=setTimeout(()=>supervise(wid),60000);});}

export const freshTeacherRoutes:FastifyPluginAsync=async app=>{
 app.get('/workspaces/:wid/plugins/fresh-teacher/analytics',async req=>{const {wid}=await scope(req);const sources=await pool.query('SELECT * FROM fresh_teacher_sources WHERE workspace_id=$1 ORDER BY repo',[wid]);const recent=await pool.query('SELECT * FROM fresh_teacher_items WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 100',[wid]);return {sources:sources.rows,recent:recent.rows};});
 const wid=process.env.FRESH_TEACHER_WORKSPACE_ID;if(wid){if(restartTimer)clearTimeout(restartTimer);setTimeout(()=>supervise(wid),5000);}
};
