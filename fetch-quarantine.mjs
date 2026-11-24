// Darwin's public workflow, step "Darwin's dependency quarantine": downloads the quarantine file this run was given
// (darwin-quarantine-v1: the repository's packages' recent releases, held until Stella has detonated them, and the
// verdicts it signed), refuses it unless its size and SHA-256 are the ones the token exchange issued, and writes it
// where the engine reads it (dovel-flow's `quarantine` input). The engine verifies every verdict's signature against
// the Stella keys it pins before acting on any. Dependency-free.
//
// A run without a quarantine file still runs, as it would without the quarantine: nothing issued (the quarantine off),
// or a download that fails, leaves the step's `path` output empty.
//
//   node fetch-quarantine.mjs <file>
//   env: DARWIN_RUN_TOKEN, QUARANTINE_URL, QUARANTINE_SHA256, QUARANTINE_SIZE, GITHUB_OUTPUT

import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const target = resolve(process.argv[2] ?? 'quarantine.json')
const { DARWIN_RUN_TOKEN: token, QUARANTINE_URL: url, QUARANTINE_SHA256: expected, QUARANTINE_SIZE: size } = process.env
const skip = message => {
  console.log(`::warning title=Darwin::${message} This run proposes releases as it would without the dependency quarantine.`)
  process.exit(0)
}
if (!url) {
  console.log('Darwin\'s dependency quarantine: none was issued for this run.')
  process.exit(0)
}
if (!token || !/^[0-9a-f]{64}$/u.test(expected ?? '') || !/^\d+$/u.test(size ?? '')) skip('The dependency quarantine\'s credentials are incomplete.')

let file
for (let tries = 1; ; tries += 1) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(120_000) })
    .catch(error => ({ ok: false, status: 0, error }))
  if (response.ok) {
    file = Buffer.from(await response.arrayBuffer())
    break
  }
  if (tries >= 4 || (response.status >= 400 && response.status < 500 && response.status !== 429)) skip(`Darwin did not serve the dependency quarantine (${response.status}).`)
  await new Promise(done => setTimeout(done, tries * 5000))
}
if (file.length !== Number(size)) skip(`The dependency quarantine is ${file.length} bytes, not the ${size} Darwin issued: refusing it.`)
const actual = createHash('sha256').update(file).digest('hex')
if (actual !== expected) skip(`The dependency quarantine's SHA-256 is ${actual}, not ${expected}: refusing it.`)

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, file)
appendFileSync(process.env.GITHUB_OUTPUT, `path=${target}\n`)
console.log(`Darwin's dependency quarantine: ${file.length} bytes, SHA-256 verified, at ${target}.`)
