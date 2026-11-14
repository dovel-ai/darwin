// Darwin's public workflow, step "Darwin's engine": downloads the engine this run
// was given (it is never public), refuses it unless its size and SHA-256 are the
// ones the token exchange issued, and unpacks it. Dependency-free.
//
//   node fetch-engine.mjs <directory>
//   env: DARWIN_RUN_TOKEN, ENGINE_URL, ENGINE_SHA256, ENGINE_SIZE

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const target = resolve(process.argv[2] ?? 'dovel-product')
const { DARWIN_RUN_TOKEN: token, ENGINE_URL: url, ENGINE_SHA256: expected, ENGINE_SIZE: size } = process.env
const fail = message => { console.log(`::error title=Darwin::${message}`); process.exit(1) }
if (!token || !url || !/^[0-9a-f]{64}$/u.test(expected ?? '') || !/^\d+$/u.test(size ?? '')) fail('The engine credentials are missing; the credentials step must run first.')

let archive
for (let tries = 1; ; tries += 1) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) }).catch(error => ({ ok: false, status: 0, error }))
  if (response.ok) {
    archive = Buffer.from(await response.arrayBuffer())
    break
  }
  if (tries >= 4 || (response.status >= 400 && response.status < 500 && response.status !== 429)) fail(`Darwin did not serve the engine (${response.status}).`)
  await new Promise(done => setTimeout(done, tries * 5000))
}
if (archive.length !== Number(size)) fail(`The engine is ${archive.length} bytes, not the ${size} Darwin issued: refusing it.`)
const actual = createHash('sha256').update(archive).digest('hex')
if (actual !== expected) fail(`The engine's SHA-256 is ${actual}, not ${expected}: refusing it.`)

const scratch = mkdtempSync(join(tmpdir(), 'darwin-engine-'))
const file = join(scratch, 'engine.tar.gz')
writeFileSync(file, archive)
// The archive is git's own output (relative paths only); it is still listed first and anything
// absolute or climbing out of the target refused.
const entries = execFileSync('tar', ['-tzf', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
if (entries.some(entry => entry.startsWith('/') || entry.split('/').includes('..'))) fail('The engine archive has an unsafe path: refusing it.')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
execFileSync('tar', ['-xzf', file, '-C', target, '--no-same-owner'])
rmSync(scratch, { recursive: true, force: true })
console.log(`Darwin's engine: ${(archive.length / 1048576).toFixed(1)} MB, SHA-256 verified, ${readdirSync(target).length} entries in ${target}.`)
