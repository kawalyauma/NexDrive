import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, copyFile, constants } from 'node:fs/promises';
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
 const blobKey=wid.toLowerCase()+'/'+randomUUID(),target=blobPath(blobKey),temp=target+'.part';
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
export async function cloneBlob(original:string,wid:string):Promise<string>{
 const newKey=wid.toLowerCase()+'/'+randomUUID();
 const target=blobPath(newKey);
 await mkdir(dirname(target),{recursive:true,mode:0o700});
 await copyFile(blobPath(original),target,constants.COPYFILE_EXCL);
 return newKey;
}
export async function removeBlob(key:string):Promise<void>{await rm(blobPath(key),{force:true});}
export function streamBlob(key:string,range?:{start:number;end:number}){
 return createReadStream(blobPath(key),range?{start:range.start,end:range.end}:undefined);
}
export function safeFileName(name:string):string{
 const x=name.trim().normalize('NFC');
 if(!x||x.length>255||x.includes('/')||x.includes(String.fromCharCode(92))||x==='.'||x==='..'||Array.from(x).some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127))throw bad('Invalid name');
 return x;
}
export function downloadName(name:string):string {
 return "attachment; filename*=UTF-8''"+encodeURIComponent(name);
}
