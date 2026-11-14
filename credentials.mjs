// Darwin's public workflow, step "Credentials from Darwin": exchanges this job's GitHub
// OIDC token for the job's credentials (packages/cloud/src/actions/exchange.ts)
// and hands them to later steps as masked step outputs. Dependency-free: it runs
// before anything is installed.
//
//   node credentials.mjs <run|publish>
//   env: DARWIN_API, ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN, GITHUB_OUTPUT

import { appendFileSync } from 'node:fs'

const purpose = process.argv[2]
if (purpose !== 'run' && purpose !== 'publish') fail('usage: credentials.mjs <run|publish>')

const api = new URL(process.env.DARWIN_API ?? 'https://api.dovellabs.si')
if (api.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(api.hostname)) fail(`DARWIN_API must be https: ${api}`)
const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
if (!requestUrl || !requestToken) fail('This job cannot request a GitHub OIDC token: the calling workflow must grant `id-token: write`.')

function fail(message) {
  console.log(`::error title=Darwin::${message}`)
  process.exit(1)
}

async function attempt(work, what) {
  for (let tries = 1; ; tries += 1) {
    try {
      return await work()
    } catch (error) {
      if (tries >= 4 || error.permanent) fail(`${what}: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, tries * 5000))
    }
  }
}

// GitHub's OIDC token for this job, for this API (its origin is the audience). Darwin accepts each
// token once, so every attempt at the exchange asks GitHub for a fresh one.
const freshOidc = () => attempt(async () => {
  const url = new URL(requestUrl)
  url.searchParams.set('audience', api.origin)
  const response = await fetch(url, { headers: { authorization: `bearer ${requestToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status}`), { permanent: response.status < 500 })
  const body = await response.json()
  if (typeof body.value !== 'string') throw new Error('GitHub returned no token')
  return body.value
}, 'Requesting the job\'s GitHub OIDC token')

const credentials = await attempt(async () => {
  const oidc = await freshOidc()
  const response = await fetch(new URL('/actions/token', api), {
    method: 'POST',
    headers: { authorization: `Bearer ${oidc}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ purpose }),
    signal: AbortSignal.timeout(60_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    // A refusal says why (problem details); only outages and rate limits are worth another try.
    throw Object.assign(new Error(body.detail ?? body.title ?? `Darwin answered ${response.status}`), { permanent: response.status < 500 && response.status !== 429 })
  }
  return body
}, 'Darwin did not issue this job\'s credentials')

if (typeof credentials.engine?.url !== 'string' || !/^[0-9a-f]{64}$/u.test(credentials.engine.sha256 ?? '')) fail('Darwin issued no engine for this run.')

// Masked before anything else can print them.
const secrets = [credentials.token, credentials.model?.apiKey, credentials.github?.token].filter(value => typeof value === 'string' && value !== '')
for (const secret of secrets) console.log(`::add-mask::${secret}`)

const outputs = {
  'run-id': credentials.run.id,
  'run-token': credentials.token,
  'model-key': credentials.model?.apiKey ?? '',
  // Which engine input the key goes to: openrouter-api-key or anthropic-api-key.
  'model-provider': credentials.model?.provider ?? '',
  // The engine's own cap on this run's model spend (absent from an older Darwin: the engine's default).
  'max-model-spend-usd': credentials.settings.maxModelSpendUsd === undefined ? '' : String(credentials.settings.maxModelSpendUsd),
  'github-token': credentials.github?.token ?? '',
  'max-candidates': String(credentials.settings.maxCandidates),
  'open-pr': String(credentials.settings.openPr),
  'ci-gate': String(credentials.settings.ciGate),
  'ci-repair': String(credentials.settings.ciRepair),
  // The engine to download (not secret): fetch-engine.mjs checks it against this size and SHA-256.
  'engine-url': credentials.engine.url,
  'engine-sha256': credentials.engine.sha256,
  'engine-size': String(credentials.engine.size),
  'engine-commit': credentials.engine.commit,
  'engine-version': credentials.engine.version,
  // The change registry to match the code against (not secret; absent from an older Darwin, or while
  // Darwin holds none): fetch-change-registry.mjs checks it against this size and SHA-256.
  'change-registry-url': typeof credentials.changeRegistry?.url === 'string' ? credentials.changeRegistry.url : '',
  'change-registry-sha256': /^[0-9a-f]{64}$/u.test(credentials.changeRegistry?.sha256 ?? '') ? credentials.changeRegistry.sha256 : '',
  'change-registry-size': Number.isSafeInteger(credentials.changeRegistry?.size) ? String(credentials.changeRegistry.size) : '',
}
for (const [name, value] of Object.entries(outputs)) {
  if (/[\r\n]/u.test(value)) fail(`credential ${name} is malformed`)
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}
console.log(`Darwin run ${credentials.run.id} on ${credentials.run.repository}: ${purpose} credentials issued${credentials.model ? ', with a model key' : ', without a model key'}.`)
