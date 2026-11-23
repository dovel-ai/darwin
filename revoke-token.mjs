// Darwin's public workflow, a job's last step: revokes the GitHub token Darwin issued the job (an installation token
// minted for this repository alone), so it stops working when the job ends, not up to an hour later. It reads the token
// from the environment only and never prints it. A failure is reported and tolerated: the token still expires within
// the hour it was minted for. Dependency-free.
//
//   node revoke-token.mjs
//   env: GH_TOKEN (none: nothing to revoke), GITHUB_API_URL (the runner's; https://api.github.com otherwise)

const token = process.env.GH_TOKEN ?? ''
if (token === '') {
  console.log('No GitHub token was issued to this job: nothing to revoke.')
  process.exit(0)
}
const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/u, '')
try {
  const response = await fetch(`${api}/installation/token`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    signal: AbortSignal.timeout(15_000),
  })
  console.log(response.status === 204 ? 'The job\'s GitHub token is revoked.' : `GitHub answered ${response.status}: the job's GitHub token was not revoked, and expires within the hour.`)
} catch (error) {
  console.log(`The job's GitHub token was not revoked (${error instanceof Error ? error.message : String(error)}); it expires within the hour.`)
}
