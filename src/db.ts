import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const pool=new pg.Pool({
 connectionString:process.env.DATABASE_URL||undefined,
 max:15,connectionTimeoutMillis:10000,idleTimeoutMillis:30000
});
export async function initDatabase():Promise<void>{
 if(!process.env.DATABASE_URL&&!process.env.PGHOST)
  throw new Error('Configure DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE');
 const schema=await readFile(resolve(process.cwd(),'db/schema.sql'),'utf8');
 await pool.query(schema);
}
export async function transaction<T>(fn:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
 catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
