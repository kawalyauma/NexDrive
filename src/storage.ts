import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile } from '@fastify/multipart';
import { bad } from './auth.js';
const root=resolve(process.env.STORAGE_DIR||'./data');
export const maxUploadBytes=Number(process.env.MAX_UPLOAD_BYTES||268435456);
export const defaultQuotaBytes=Number(process.env.DEFAULT_WORKSPACE_QUOTA_BYTES||10737418240);
export function blobPath(key:string):string {
 if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw bad('Invalid storage key',500);
 return join(root,key);
}
export async function saveUpload(file:MultipartFile,wid:string):Promise<{blobKey:string;size:number}>{
 const blobKey=wid+'/'+randomUUID(),target=blobPath(blobKey),temp=target+'.part';
 await mkdir(dirname(target),{recursive:true,mode:0o700});
 let size=0;
 try {
 file.file.on('data',(chunk:Buffer)=>{size+=chunk.length;});
 await pipeline(file.file,createWriteStream(temp,{flags:'wx',mode:0o600}));
 if(file.file.truncated||size>maxUploadBytes) throw bad('File exceeds upload limit',413);
 await rename(temp,target);
 return {blobKey,size};
 } catch(err){await rm(temp,{force:true}).catch(()=>{});throw err;}
}
export async function removeBlob(key:string):Promise<void>{await rm(blobPath(key),{force:true});}
export function streamBlob(key:string){return createReadStream(blobPath(key));}
export function safeFileName(name:string):string{
 const x=name.trim().normalize('NFC');
 if(!x||x.length>255||x.includes('/')||x.includes('\\')||x==='.'||x==='..')throw bad('Invalid name');
 return x;
}
export function downloadName(name:string):string {
 return "attachment; filename*=UTF-8''"+encodeURIComponent(name);
}
