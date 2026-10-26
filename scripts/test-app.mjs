// Product tests for the Supabase/Vercel app. The original Grok distribution
// assembly checks have their own command because its .grok assets are not shipped here.
import {readdirSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
const templateFiles=new Set(['brand-check.test.mjs','check-auth-invariant.test.mjs','grok-pwa-plugin.test.mjs','migration-plan.test.mjs','with-app-env.test.mjs','write-atomic.test.mjs'])
const mode=process.argv[2]
const scripts=readdirSync(new URL('./',import.meta.url)).filter(f=>f.endsWith('.test.mjs') && (mode==='template' ? templateFiles.has(f) : !templateFiles.has(f))).map(f=>`scripts/${f}`)
const lib=mode==='template' ? [] : readdirSync(new URL('../src/lib/',import.meta.url)).filter(f=>f.endsWith('.test.js')).map(f=>`src/lib/${f}`)
const typed=mode==='template' ? [] : ['src/lib/app-data/app-data.test.ts','src/lib/auth/gate-identity.test.ts']
const result=spawnSync(process.execPath,['--experimental-strip-types','--test',...scripts,...lib,...typed],{stdio:'inherit'})
process.exit(result.status ?? 1)
