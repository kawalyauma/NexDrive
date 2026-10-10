import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {pool} from '../db.js';
import {bad} from '../auth.js';
import {scope,uuid} from './util.js';

/**
 * The Telegram importer runs on its own as the telegram-service container. These routes only report its live progress
 * and let the workspace pause, resume or ask for an immediate check.
 */
export const telegramRoutes:FastifyPluginAsync=async app=>{
 app.get('/workspaces/:wid/plugins/telegram/status',async req=>{
  const {wid}=await scope(req);
  const service=(await pool.query(`SELECT *,(heartbeat_at > now() - interval '45 seconds') AS online FROM telegram_service WHERE workspace_id=$1`,[wid])).rows[0]??null;
  const job=(await pool.query(`SELECT * FROM telegram_jobs WHERE workspace_id=$1 ORDER BY (id=$2) DESC,created_at DESC LIMIT 1`,[wid,service?.current_job??null])).rows[0]??null;
  const totals=(await pool.query(`SELECT count(*) FILTER (WHERE status='posted')::int AS posted,count(*) FILTER (WHERE status='skipped')::int AS skipped,
    count(*) FILTER (WHERE status='failed')::int AS failed,count(*) FILTER (WHERE status IN ('downloading','stored'))::int AS pending,
    coalesce(sum(size_bytes) FILTER (WHERE node_id IS NOT NULL),0)::text AS bytes,max(updated_at) AS last_file_at
    FROM telegram_items WHERE workspace_id=$1`,[wid])).rows[0];
  const items=await pool.query('SELECT id,file_name,size_bytes,status,edushare_resource_id,edushare_slug,error,message_id,updated_at FROM telegram_items WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 30',[wid]);
  return {service,job,totals,items:items.rows};
 });
 app.post('/workspaces/:wid/plugins/telegram/service',async req=>{
  const {wid}=await scope(req,'write');
  const body=z.object({enabled:z.boolean().optional(),runNow:z.boolean().optional()}).parse(req.body??{});
  await pool.query(`INSERT INTO telegram_service(workspace_id,enabled,run_now) VALUES($1,coalesce($2,true),coalesce($3,false))
    ON CONFLICT(workspace_id) DO UPDATE SET enabled=coalesce($2,telegram_service.enabled),run_now=coalesce($3,telegram_service.run_now),updated_at=now()`,
   [wid,body.enabled??null,body.runNow??null]);
  return {ok:true};
 });
 app.get('/workspaces/:wid/plugins/telegram/jobs',async req=>{
  const {wid}=await scope(req);
  const jobs=await pool.query('SELECT * FROM telegram_jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20',[wid]);
  return {jobs:jobs.rows};
 });
 app.get('/workspaces/:wid/plugins/telegram/jobs/:id',async req=>{
  const {wid}=await scope(req);const {id}=z.object({id:uuid}).parse(req.params);
  const job=(await pool.query('SELECT * FROM telegram_jobs WHERE id=$1 AND workspace_id=$2',[id,wid])).rows[0];
  if(!job)throw bad('Import job not found',404);
  const items=await pool.query('SELECT * FROM telegram_items WHERE job_id=$1 ORDER BY updated_at DESC LIMIT 200',[id]);
  return {job,items:items.rows};
 });
};
