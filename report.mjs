// Darwin's workflow, step "Report to Darwin": uploads what this job produced
// and reports its end (the job's run token is revoked by that report).
// Dependency-free.
//
//   node report.mjs <run|publish> <directory> <success|failure|cancelled|skipped>
//   env: DARWIN_API, DARWIN_RUN_ID, DARWIN_RUN_TOKEN

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [job, directory, rawOutcome] = process.argv.slice(2)
const outcome = rawOutcome === 'success' ? 'success' : rawOutcome === 'cancelled' ? 'cancelled' : 'failure'
const api = new URL(process.env.DARWIN_API ?? 'https://api.dovellabs.si')
const runId = process.env.DARWIN_RUN_ID
const token = process.env.DARWIN_RUN_TOKEN
if (!runId || !token) {
  console.log('::warning title=Darwin::No run credentials: nothing to report.')
  process.exit(0)
}

const RUN_FILES = ['change-notices.json', 'CHANGE-NOTICES.md', 'security-advisories.json', 'SECURITY-ADVISORIES.md', 'agent-tooling.json', 'repository-knowledge.json', 'dependency-changelog.json', 'repository-progress.json', 'readiness-inputs.json', 'candidate-receipts.json',
  'scan-incomplete.json', 'registry-lookup-errors.json', 'model-provider-unavailable.json', 'model-usage.json', 'KNOWLEDGE.md', 'CHANGELOG.md', 'PROGRESS.md', 'flow.log']
const PUBLISH_FILES = ['publication-results.json', 'notice-fix-results.json', 'handoff-report.json', 'repository-progress.json', 'PROGRESS.md', 'ci-repair-results.json', 'model-usage.json', 'publish.log']
const MAX_FILE = 10 * 1024 * 1024
const LOG_TAIL = 5 * 1024 * 1024

async function send(method, path, body, contentType) {
  for (let tries = 1; ; tries += 1) {
    const response = await fetch(new URL(path, api), {
      method, body, signal: AbortSignal.timeout(120_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType, accept: 'application/json' },
    }).catch(error => ({ ok: false, status: 0, error }))
    if (response.ok) return true
    if (tries >= 4 || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
      const detail = response.json ? (await response.json().catch(() => ({}))).detail : response.error?.message
      console.log(`::warning title=Darwin::${method} ${path} failed (${response.status}): ${detail ?? 'no detail'}`)
      return false
    }
    await new Promise(resolve => setTimeout(resolve, tries * 5000))
  }
}

const files = []
const add = (local, remote) => {
  try {
    if (statSync(local).isFile()) files.push([local, remote])
  } catch { /* not produced this time */ }
}
if (job === 'run') {
  for (const name of RUN_FILES) add(join(directory, name), name)
  try {
    for (const name of readdirSync(join(directory, 'candidate-receipts'))) {
      if (/^[A-Za-z0-9._-]{1,120}\.(patch|json)$/u.test(name)) add(join(directory, 'candidate-receipts', name), `candidate-receipts/${name}`)
    }
  } catch { /* no receipts */ }
} else {
  for (const name of PUBLISH_FILES) add(join(directory, name), `published/${name}`)
}

let uploaded = 0
for (const [local, remote] of files) {
  let content = readFileSync(local)
  // A log keeps its end (where failures are); anything else over the limit is skipped, not truncated.
  if (remote.endsWith('.log') && content.length > LOG_TAIL) content = content.subarray(content.length - LOG_TAIL)
  if (content.length > MAX_FILE) {
    console.log(`::warning title=Darwin::${remote} is over 10 MB and was not uploaded.`)
    continue
  }
  if (await send('PUT', `/actions/runs/${runId}/files/${remote.split('/').map(encodeURIComponent).join('/')}`, content, 'application/octet-stream')) uploaded += 1
}
const reported = await send('POST', `/actions/runs/${runId}/finish`, JSON.stringify({ outcome }), 'application/json')
console.log(`Darwin: ${uploaded} of ${files.length} file(s) uploaded; ${job} job reported ${reported ? outcome : 'NOT reported'}.`)
