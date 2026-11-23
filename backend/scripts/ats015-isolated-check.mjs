import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const source = new URL(process.env.DATABASE_URL || '');
if (source.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '::1'].includes(source.hostname)) throw new Error('仅允许本机 MySQL');
const db = `ats015_tmp_${randomBytes(6).toString('hex')}`; source.pathname = `/${db}`;
const mysql = process.env.ATS015_MYSQL_BIN || process.env.ATS014_MYSQL_BIN || 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe';
if (!existsSync(mysql)) throw new Error('找不到 MySQL 客户端');
const env = { ...process.env, MYSQL_PWD: decodeURIComponent(source.password), DATABASE_URL: source.toString(), ATS015_ISOLATED_TEST: '1' };
const args = ['--protocol=TCP','--host',source.hostname,'--port',source.port || '3306','--user',decodeURIComponent(source.username)];
function run(exe, argv) { const r=spawnSync(exe,argv,{env,stdio:'inherit',shell:false}); if (r.status !== 0) throw new Error(`${exe} exited ${r.status}`); }
let created=false;
try { run(mysql,[...args,'--execute',`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]); created=true; run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','prisma/schema.prisma']); run(process.execPath,['node_modules/vitest/vitest.mjs','run','src/offers/offers.integration.spec.ts']); }
finally { if(created) { run(mysql,[...args,'--execute',`DROP DATABASE \`${db}\``]); console.log('临时测试库已删除。'); } }
