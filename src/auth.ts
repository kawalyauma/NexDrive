import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {SignJWT,jwtVerify} from 'jose';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {pool} from './db.js';
const secretString=process.env.SESSION_SECRET||'';
const secret=new TextEncoder().encode(secretString);
export const isProduction=process.env.NODE_ENV==='production';
export const publicOrigin=process.env.PUBLIC_ORIGIN||'http://localhost:8080';
export function validateConfiguration():void {
 if(secretString.length<32)throw new Error('SESSION_SECRET must have at least 32 characters');
 if(isProduction&&!publicOrigin.startsWith('https://'))throw new Error('PUBLIC_ORIGIN must use HTTPS');
}
export type Principal={type:'user';id:string;email:string}|{type:'app';id:string;workspaceId:string;permission:'read'|'write'};
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const newOpaqueToken=(prefix='')=>prefix+randomBytes(32).toString('base64url');
export const newId=()=>randomUUID();
export function bad(message:string,statusCode=400):Error{
 return Object.assign(new Error(message),{statusCode});
}
export async function setSession(reply:FastifyReply,id:string):Promise<void>{
 const token=await new SignJWT({sub:id}).setProtectedHeader({alg:'HS256'})
 .setIssuedAt().setIssuer('nexdrive').setAudience('nexdrive-web').setExpirationTime('7d').sign(secret);
 reply.setCookie('nexdrive_session',token,{
 path:'/',httpOnly:true,secure:isProduction,sameSite:'lax',maxAge:604800});
}
export async function resolvePrincipal(req:FastifyRequest):Promise<Principal|null>{
 const header=req.headers.authorization;
 if(header?.startsWith('Bearer nd_')){
 const key=(await pool.query('SELECT id,workspace_id,permission FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL',
 [digest(header.slice(7))])).rows[0];
 if(!key)return null;
 return {type:'app',id:key.id,workspaceId:key.workspace_id,permission:key.permission};
 }
 const token=req.cookies.nexdrive_session;
 if(!token)return null;
 try{
 const {payload}=await jwtVerify(token,secret,{issuer:'nexdrive',audience:'nexdrive-web'});
 if(typeof payload.sub!=='string')return null;
 const user=(await pool.query('SELECT id,email FROM users WHERE id=$1',[payload.sub])).rows[0];
 return user?{type:'user',id:user.id,email:user.email}:null;
 }catch{return null;}
}
export function requireUser(p:Principal|null):asserts p is Extract<Principal,{type:'user'}>{
 if(!p||p.type!=='user')throw bad('Login required',401);
}
export async function access(p:Principal|null,wid:string,needed:'read'|'write'|'admin'='read'):
 Promise<'owner'|'admin'|'member'|'app'>{
 if(!p)throw bad('Authentication required',401);
 if(p.type==='app'){
 if(p.workspaceId!==wid||needed==='admin'||(needed==='write'&&p.permission!=='write'))
 throw bad('Forbidden',403);
 return 'app';
 }
 const role=(await pool.query('SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2',
 [wid,p.id])).rows[0]?.role;
 if(!role)throw bad('Workspace not found',403);
 if(needed==='admin'&&role==='member')throw bad('Admin required',403);
 return role;
}
export function requireSameOrigin(req:FastifyRequest):void{
 if(['GET','HEAD','OPTIONS'].includes(req.method))return;
 if(req.headers.authorization?.startsWith('Bearer nd_'))return;
 const origin=req.headers.origin;
 if(origin&&origin!==publicOrigin&&!(process.env.NODE_ENV!=='production'&&origin==='http://localhost:5173'))
 throw bad('Origin denied',403);
 if(!origin&&req.cookies.nexdrive_session)throw bad('Origin required',403);
}
