// Darwin's public workflow, step "Darwin's change registry": downloads the change
// registry this run was given (what providers announced: a model retired, an
// endpoint removed, an API version switched off), refuses it unless its size and
// SHA-256 are the ones the token exchange issued, and writes it where the engine
// reads it (dovel-flow's `change-registry` input). Dependency-free.
//
// A run without a registry still runs: nothing issued, or a download that fails,
// leaves the step's `path` output empty and the run matches no announcement.
//
//   node fetch-change-registry.mjs <file>
//   env: DARWIN_RUN_TOKEN, CHANGE_REGISTRY_URL, CHANGE_REGISTRY_SHA256, CHANGE_REGISTRY_SIZE, GITHUB_OUTPUT

import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const target = resolve(process.argv[2] ?? 'change-registry.json')
const { DARWIN_RUN_TOKEN: token, CHANGE_REGISTRY_URL: url, CHANGE_REGISTRY_SHA256: expected, CHANGE_REGISTRY_SIZE: size } = process.env
const skip = message => {
  console.log(`::warning title=Darwin::${message} This run matches no provider announcement.`)
  process.exit(0)
}
if (!url) {
  console.log('Darwin\'s change registry: none was issued for this run.')
  process.exit(0)
}
if (!token || !/^[0-9a-f]{64}$/u.test(expected ?? '') || !/^\d+$/u.test(size ?? '')) skip('The change registry\'s credentials are incomplete.')

let registry
for (let tries = 1; ; tries += 1) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(120_000) })
    .catch(error => ({ ok: false, status: 0, error }))
  if (response.ok) {
    registry = Buffer.from(await response.arrayBuffer())
    break
  }
  if (tries >= 4 || (response.status >= 400 && response.status < 500 && response.status !== 429)) skip(`Darwin did not serve the change registry (${response.status}).`)
  await new Promise(done => setTimeout(done, tries * 5000))
}
if (registry.length !== Number(size)) skip(`The change registry is ${registry.length} bytes, not the ${size} Darwin issued: refusing it.`)
const actual = createHash('sha256').update(registry).digest('hex')
if (actual !== expected) skip(`The change registry's SHA-256 is ${actual}, not ${expected}: refusing it.`)

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, registry)
appendFileSync(process.env.GITHUB_OUTPUT, `path=${target}\n`)
console.log(`Darwin's change registry: ${(registry.length / 1048576).toFixed(1)} MB, SHA-256 verified, at ${target}.`)
