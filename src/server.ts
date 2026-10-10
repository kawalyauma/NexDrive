import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {initDatabase,pool} from './db.js';
import {publicOrigin,validateConfiguration,requireSameOrigin} from './auth.js';
import {maxUploadBytes} from './storage.js';
import {authRoutes} from './routes/auth-routes.js';
import {nodeRoutes} from './routes/node-routes.js';
import {managementRoutes} from './routes/management-routes.js';

async function start(){
 validateConfiguration();
 if(!Number.isSafeInteger(maxUploadBytes)||maxUploadBytes<1)throw new Error('Invalid MAX_UPLOAD_BYTES');
 await initDatabase();
 const app=Fastify({logger:{redact:['req.headers.authorization','req.headers.cookie','res.headers.set-cookie']},
 bodyLimit:1024*1024,trustProxy:false});
 await app.register(cookie);
 await app.register(rateLimit,{max:180,timeWindow:'1 minute'});
 await app.register(multipart,{limits:{fileSize:maxUploadBytes,files:1,fields:3},throwFileSizeLimit:false});
 app.addHook('onRequest',async req=>requireSameOrigin(req));
 app.setErrorHandler((err,req,reply)=>{
 const status=('statusCode' in err && typeof err.statusCode==='number')
 ?Math.max(400,Math.min(599,err.statusCode)):500;
 if(status>=500)req.log.error(err);
 reply.status(status).send({error:status===500?'Internal server error':err.message});
 });
 app.get('/api/health',async()=>({status:'ok'}));
 await app.register(authRoutes,{prefix:'/api'});
 await app.register(nodeRoutes,{prefix:'/api'});
 await app.register(managementRoutes,{prefix:'/api'});
 const webDir=resolve(process.cwd(),'web/dist');
 if(existsSync(resolve(webDir,'index.html'))){
 await app.register(staticFiles,{root:webDir,prefix:'/',wildcard:false});
 app.setNotFoundHandler((req,reply)=>{
  if(req.method==='GET'&&!req.url.startsWith('/api/'))return reply.sendFile('index.html');
  return reply.status(404).send({error:'Not found'});
 });
 }
 const port=Number(process.env.PORT||8080);
 await app.listen({host:'0.0.0.0',port});
 app.log.info({publicOrigin},'NexDrive ready');
 const shutdown=async()=>{await app.close();await pool.end();};
 process.once('SIGTERM',()=>{void shutdown();});
 process.once('SIGINT',()=>{void shutdown();});
}
start().catch(error=>{console.error(error);process.exit(1);});
