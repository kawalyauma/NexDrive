import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pool,transaction} from '../db.js';
import {bad,newId} from '../auth.js';
import {blobPath,maxUploadBytes,safeFileName} from '../storage.js';

type WorkerEvent={event:string;message_id?:number;name?:string;size?:number;done?:number;total?:number;
 path?:string;sha256?:string;mime_type?:string;caption?:string;reason?:string;seconds?:number;group?:string};

function titleFromName(name:string){
 return name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,200)||'Untitled resource';
}

function suffixedName(name:string,suffix:string){
 const dot=name.lastIndexOf('.');
 return dot>0?`${name.slice(0,dot)} ${suffix}${name.slice(dot)}`:`${name} ${suffix}`;
}

async function availableName(wid:string,parentId:string,original:string,messageId?:number){
 const base=safeFileName(original);
 if(!(await pool.query('SELECT 1 FROM nodes WHERE workspace_id=$1 AND parent_id=$2 AND name=$3 AND deleted_at IS NULL',[wid,parentId,base])).rowCount)return base;
 const label=`(Telegram ${messageId||'copy'})`;
 let candidate=safeFileName(suffixedName(base,label)),counter=2;
 while((await pool.query('SELECT 1 FROM nodes WHERE workspace_id=$1 AND parent_id=$2 AND name=$3 AND deleted_at IS NULL',[wid,parentId,candidate])).rowCount){
  candidate=safeFileName(suffixedName(base,`${label} ${counter++}`));
 }
 return candidate;
}

async function telegramFolder(wid:string,userId:string|null){
 const name='Telegram — P.7 Teachers in Uganda';
 const found=(await pool.query("SELECT id FROM nodes WHERE workspace_id=$1 AND parent_id IS NULL AND kind='folder' AND name=$2 AND deleted_at IS NULL",[wid,name])).rows[0];
 if(found)return found.id as string;
 const id=newId();
 await pool.query("INSERT INTO nodes(id,workspace_id,parent_id,created_by,kind,name) VALUES($1,$2,NULL,$3,'folder',$4)",[id,wid,userId,name]);
 return id;
}

async function adoptFile(wid:string,userId:string|null,event:WorkerEvent){
 if(!event.path||!event.name||!event.sha256||!event.size||!event.mime_type)throw new Error('Incomplete worker result');
 const duplicate=(await pool.query("SELECT id,name FROM nodes WHERE workspace_id=$1 AND kind='file' AND sha256=$2 AND deleted_at IS NULL LIMIT 1",[wid,event.sha256])).rows[0];
 if(duplicate){await rm(event.path,{force:true});return duplicate;}
 const folderId=await telegramFolder(wid,userId),id=newId(),blobKey=wid+'/'+newId(),target=blobPath(blobKey);
 const filename=await availableName(wid,folderId,event.name,event.message_id);
 await mkdir(dirname(target),{recursive:true,mode:0o700});
 await rename(event.path,target);
 try{
  await transaction(async db=>{
   const ws=(await db.query('SELECT quota_bytes FROM workspaces WHERE id=$1 FOR UPDATE',[wid])).rows[0];
   const used=(await db.query("SELECT ((SELECT coalesce(sum(size_bytes),0) FROM nodes WHERE workspace_id=$1 AND kind='file')+(SELECT coalesce(sum(size_bytes),0) FROM file_versions WHERE workspace_id=$1))::text AS used",[wid])).rows[0].used;
   if(BigInt(used)+BigInt(event.size!)>BigInt(ws.quota_bytes))throw bad('Workspace storage quota exceeded',413);
   await db.query("INSERT INTO nodes(id,workspace_id,parent_id,created_by,kind,name,blob_key,size_bytes,mime_type,sha256) VALUES($1,$2,$3,$4,'file',$5,$6,$7,$8,$9)",
    [id,wid,folderId,userId,filename,blobKey,event.size,event.mime_type,event.sha256]);
  });
  return {id,name:filename};
 }catch(error){await rm(target,{force:true});throw error;}
}

async function postToEduShare(nodeId:string,event:WorkerEvent){
 const base=process.env.EDUSHARE_URL?.replace(/\/$/,'');
 const key=process.env.EDUSHARE_INTEGRATION_KEY;
 if(!base||!key)throw new Error('EduShare integration is not configured');
 const response=await fetch(base+'/api/integrations/telegram/resources',{
  method:'POST',headers:{'content-type':'application/json','x-integration-key':key},
  body:JSON.stringify({nodeId,messageId:event.message_id,group:process.env.TELEGRAM_GROUP,
   fileName:event.name,sizeBytes:event.size,sha256:event.sha256,title:titleFromName(event.name!),
   description:event.caption||undefined})
 });
 const body=await response.json().catch(()=>({})) as any;
 if(!response.ok){
  const detail=typeof body.error==='string'?body.error:body.error?.message;
  throw new Error(detail||`EduShare rejected the file (${response.status})`);
 }
 return body;
}

/**
 * One import pass: reads the group from the last processed message onwards, downloads new teaching files into the drive
 * and registers them on EduShare. `shouldStop` is checked every few seconds so a pause takes effect mid-download.
 */
export async function runJob(jobId:string,wid:string,userId:string|null,shouldStop:()=>Promise<boolean>=async()=>false){
 const required=['TELEGRAM_API_ID','TELEGRAM_API_HASH','TELEGRAM_GROUP','TELEGRAM_SESSION'] as const;
 for(const key of required)if(!process.env[key])throw new Error(`${key} is not configured`);
 const output=join(process.env.STORAGE_DIR||'/data','.telegram',jobId);
 await mkdir(output,{recursive:true,mode:0o700});
 const cursor=(await pool.query(`SELECT greatest(coalesce(
   (SELECT min(message_id)-1 FROM telegram_items WHERE workspace_id=$1 AND status IN ('failed','downloading')),
   (SELECT max(message_id) FROM telegram_items WHERE workspace_id=$1 AND status IN ('posted','skipped','stored')),
   0),0) AS min_id`,[wid])).rows[0].min_id;
 const child=spawn('python3',['/app/plugins/telegram_worker.py','--api-id',process.env.TELEGRAM_API_ID!,
  '--api-hash',process.env.TELEGRAM_API_HASH!,'--session',process.env.TELEGRAM_SESSION!,
  '--group',process.env.TELEGRAM_GROUP!,'--output',output,'--max-bytes',String(maxUploadBytes),'--min-id',String(cursor)],
  {stdio:['pipe','pipe','pipe']});
 let stopped=false;
 const watch=setInterval(()=>{void shouldStop().then(stop=>{if(stop&&!stopped){stopped=true;child.kill('SIGTERM');}}).catch(()=>{});},5000);
 await pool.query("UPDATE telegram_jobs SET status='running',updated_at=now(),error=NULL WHERE id=$1",[jobId]);
 let currentItem:string|null=null;
 const lines=createInterface({input:child.stdout});
 try{
  for await(const line of lines){
   const event=JSON.parse(line) as WorkerEvent;
   if(event.event==='candidate'){
    const inserted=(await pool.query("INSERT INTO telegram_items(id,job_id,workspace_id,group_ref,message_id,file_name,size_bytes,status) VALUES($1,$2,$3,$4,$5,$6,$7,'downloading') ON CONFLICT(workspace_id,group_ref,message_id) DO NOTHING RETURNING id",
     [newId(),jobId,wid,process.env.TELEGRAM_GROUP,event.message_id,event.name,event.size])).rows[0];
    await pool.query('UPDATE telegram_jobs SET discovered=discovered+1,current_file=$2,current_bytes=0,current_total=$3,updated_at=now() WHERE id=$1',[jobId,event.name,event.size]);
    if(!inserted){
     const existing=(await pool.query('SELECT id,node_id,sha256,size_bytes,status FROM telegram_items WHERE workspace_id=$1 AND group_ref=$2 AND message_id=$3',
      [wid,process.env.TELEGRAM_GROUP,event.message_id])).rows[0];
     if(existing?.status==='failed'&&existing.node_id&&existing.sha256){
      try{
       const posted=await postToEduShare(existing.node_id,{...event,sha256:existing.sha256,size:Number(existing.size_bytes)});
       const status=posted.duplicate?'skipped':'posted';
       await pool.query('UPDATE telegram_items SET status=$2,edushare_resource_id=$3,edushare_slug=$4,error=NULL,updated_at=now() WHERE id=$1',
        [existing.id,status,posted.resource?.id||null,posted.resource?.slug||null]);
       await pool.query(`UPDATE telegram_jobs SET ${status}=${status}+1,updated_at=now() WHERE id=$1`,[jobId]);
      }catch(error){
       await pool.query("UPDATE telegram_items SET error=$2,updated_at=now() WHERE id=$1",[existing.id,(error as Error).message.slice(0,500)]);
       await pool.query('UPDATE telegram_jobs SET failed=failed+1,error=$2,updated_at=now() WHERE id=$1',[jobId,(error as Error).message.slice(0,500)]);
      }
      child.stdin.write('skip\n');continue;
     }
     if(existing&&!existing.node_id&&['failed','downloading'].includes(existing.status)){
      await pool.query("UPDATE telegram_items SET job_id=$2,status='downloading',error=NULL,updated_at=now() WHERE id=$1",[existing.id,jobId]);
      currentItem=existing.id;child.stdin.write('download\n');continue;
     }
     child.stdin.write('skip\n');continue;
    }
    currentItem=inserted.id;child.stdin.write('download\n');
   }else if(event.event==='progress'){
    await pool.query('UPDATE telegram_jobs SET current_bytes=$2,current_total=$3,updated_at=now() WHERE id=$1',[jobId,event.done,event.total]);
   }else if(event.event==='complete'&&currentItem){
    try{
     const node=await adoptFile(wid,userId,event);
     await pool.query("UPDATE telegram_items SET node_id=$2,sha256=$3,size_bytes=$4,status='stored',updated_at=now() WHERE id=$1",[currentItem,node.id,event.sha256,event.size]);
     await pool.query('UPDATE telegram_jobs SET downloaded=downloaded+1,bytes_downloaded=bytes_downloaded+$2 WHERE id=$1',[jobId,event.size]);
     const posted=await postToEduShare(node.id,event);
     await pool.query("UPDATE telegram_items SET status=$2,edushare_resource_id=$3,edushare_slug=$4,updated_at=now() WHERE id=$1",
      [currentItem,posted.duplicate?'skipped':'posted',posted.resource?.id||null,posted.resource?.slug||null]);
     await pool.query(`UPDATE telegram_jobs SET ${posted.duplicate?'skipped':'posted'}=${posted.duplicate?'skipped':'posted'}+1,current_bytes=0,updated_at=now() WHERE id=$1`,[jobId]);
    }catch(error){
     await pool.query("UPDATE telegram_items SET status='failed',error=$2,updated_at=now() WHERE id=$1",[currentItem,(error as Error).message.slice(0,500)]);
     await pool.query('UPDATE telegram_jobs SET failed=failed+1,error=$2,updated_at=now() WHERE id=$1',[jobId,(error as Error).message.slice(0,500)]);
    }
    currentItem=null;child.stdin.write('continue\n');
   }else if(event.event==='done'){
    await pool.query("UPDATE telegram_jobs SET status='done',current_file=NULL,current_bytes=0,current_total=0,finished_at=now(),updated_at=now() WHERE id=$1",[jobId]);
   }
  }
  const exit=await new Promise<number|null>(resolve=>child.once('close',resolve));
  if(exit!==0){const stderr=await new Promise<string>(resolve=>{let s='';child.stderr.on('data',d=>s+=d);child.stderr.on('end',()=>resolve(s));setTimeout(()=>resolve(s),100);});throw new Error(stderr||`Telegram worker exited ${exit}`);}
 }catch(error){
  if(stopped)await pool.query("UPDATE telegram_jobs SET status='paused',current_file=NULL,current_bytes=0,current_total=0,updated_at=now(),finished_at=now() WHERE id=$1",[jobId]);
  else await pool.query("UPDATE telegram_jobs SET status='failed',error=$2,updated_at=now(),finished_at=now() WHERE id=$1",[jobId,(error as Error).message.slice(0,1000)]);
 }finally{
  clearInterval(watch);
  if(child.exitCode===null)child.kill('SIGTERM');
  await rm(output,{recursive:true,force:true}).catch(()=>{});
 }
}

