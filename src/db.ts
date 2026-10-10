import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 15, connectionTimeoutMillis: 10000 });
export async function initDatabase(): Promise<void> {
 if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
 await pool.query(await readFile(resolve(process.cwd(),'db/schema.sql'),'utf8'));
}
export async function transaction<T>(fn:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try { await client.query('BEGIN'); const val=await fn(client); await client.query('COMMIT'); return val; }
 catch (err) { await client.query('ROLLBACK'); throw err; }
 finally { client.release(); }
}
