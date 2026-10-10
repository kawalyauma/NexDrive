import {pool,initDatabase} from './db.js';
import {newId} from './auth.js';
import {runJob} from './telegram/importer.js';

/**
 * Always-on Telegram importer (its own container): imports new files from the group, then waits and checks again.
 * The web app only shows its progress and can pause or resume it (telegram_service.enabled).
 */
const POLL_SECONDS=Math.max(30,Number(process.env.TELEGRAM_POLL_SECONDS||60));
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let running=true;
for(const sig of ['SIGTERM','SIGINT'] as const)process.on(sig,()=>{running=false;});

async function workspaceId():Promise<string>{
 if(process.env.TELEGRAM_WORKSPACE_ID)return process.env.TELEGRAM_WORKSPACE_ID;
 const row=(await pool.query('SELECT workspace_id FROM telegram_jobs ORDER BY created_at DESC LIMIT 1')).rows[0]
  ??(await pool.query("SELECT id AS workspace_id FROM workspaces ORDER BY created_at LIMIT 1")).rows[0];
 if(!row)throw new Error('No workspace for Telegram imports yet');
 return row.workspace_id;
}

async function setState(wid:string,state:string,extra:{message?:string|null;job?:string|null;next?:Date|null;pass?:boolean}={}){
 await pool.query(`UPDATE telegram_service SET state=$2,message=$3,current_job=$4,heartbeat_at=now(),updated_at=now(),
   next_pass_at=$5,last_pass_at=CASE WHEN $6 THEN now() ELSE last_pass_at END WHERE workspace_id=$1`,
  [wid,state,extra.message??null,extra.job??null,extra.next??null,Boolean(extra.pass)]);
}
const enabled=async(wid:string)=>Boolean((await pool.query('SELECT enabled FROM telegram_service WHERE workspace_id=$1',[wid])).rows[0]?.enabled);

async function main(){
 await initDatabase();
 const wid=await workspaceId();
 await pool.query('INSERT INTO telegram_service(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[wid]);
 // A pass cut off by a restart is closed; the next pass resumes from the last processed message.
 await pool.query("UPDATE telegram_jobs SET status='failed',error='Interrupted by a restart; the service resumed from the last file',finished_at=now(),updated_at=now() WHERE workspace_id=$1 AND status IN ('queued','running')",[wid]);
 console.log(`Telegram service running for workspace ${wid}, checking every ${POLL_SECONDS}s`);
 while(running){
  if(!(await enabled(wid))){await setState(wid,'paused',{message:'Paused from NexDrive'});await sleep(5000);continue;}
  const job=newId();
  await pool.query("INSERT INTO telegram_jobs(id,workspace_id,group_ref,status) VALUES($1,$2,$3,'queued')",[job,wid,process.env.TELEGRAM_GROUP||'']);
  await setState(wid,'importing',{job});
  const beat=setInterval(()=>{void pool.query('UPDATE telegram_service SET heartbeat_at=now() WHERE workspace_id=$1',[wid]).catch(()=>{});},10000);
  try{
   await runJob(job,wid,null,async()=>!running||!(await enabled(wid)));
  }catch(error){
   const message=(error as Error).message.slice(0,500);
   await pool.query("UPDATE telegram_jobs SET status='failed',error=$2,finished_at=now(),updated_at=now() WHERE id=$1 AND status IN ('queued','running')",[job,message]);
  }finally{clearInterval(beat);}
  const result=(await pool.query('SELECT status,error,discovered FROM telegram_jobs WHERE id=$1',[job])).rows[0];
  // A pass that found nothing is not worth keeping in the history.
  if(result?.status==='done'&&Number(result.discovered)===0)await pool.query('DELETE FROM telegram_jobs WHERE id=$1',[job]);
  const failed=result?.status==='failed';
  const wait=(failed?5*60:POLL_SECONDS)*1000, next=new Date(Date.now()+wait);
  await setState(wid,failed?'error':'watching',{message:failed?result.error:null,next,pass:!failed});
  for(let waited=0;running&&waited<wait;waited+=5000){
   await sleep(5000);
   await pool.query('UPDATE telegram_service SET heartbeat_at=now() WHERE workspace_id=$1',[wid]);
   const row=(await pool.query('SELECT enabled,run_now FROM telegram_service WHERE workspace_id=$1',[wid])).rows[0];
   if(!row?.enabled)break;
   if(row?.run_now){await pool.query('UPDATE telegram_service SET run_now=false WHERE workspace_id=$1',[wid]);break;}
  }
 }
 await setState(wid,'stopped',{message:'Service stopped'}).catch(()=>{});
 await pool.end();
}

main().catch(error=>{console.error(error);process.exit(1);});
