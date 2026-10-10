export type Workspace={id:string;name:string;role:'owner'|'admin'|'member';quota_bytes:string};
export type Profile={user:{id:string;name:string;email:string};workspaces:Workspace[]};
export type DriveNode={id:string;parent_id:string|null;kind:'folder'|'file';name:string;size_bytes:string;created_at?:string;deleted_at?:string};
export async function api<T=unknown>(path:string,options:RequestInit&{json?:unknown}={}):Promise<T>{
 const {json,...init}=options;
 const headers=new Headers(init.headers);
 if(json!==undefined)headers.set('Content-Type','application/json');
 const response=await fetch('/api'+path,{...init,headers,credentials:'include',
  body:json!==undefined?JSON.stringify(json):init.body});
 if(!response.ok){
  const result=await response.json().catch(()=>({}));
  throw new Error(result.error||'Request failed ('+response.status+')');
 }
 return response.json() as Promise<T>;
}
export const friendlySize=(value:number|string):string=>{
 const n=Number(value)||0;
 if(n<1024)return n+' B';
 const units=['KB','MB','GB','TB'];let size=n/1024,i=0;
 while(size>=1024&&i<units.length-1){size/=1024;i++;}
 return size.toFixed(size>=10?0:1)+' '+units[i];
};
