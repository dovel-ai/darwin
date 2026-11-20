# Darwin

Darwin finds the dependency and API changes a repository is behind on, tests
each one with the repository's own checks, and proposes it as a draft pull
request a person reviews. It never merges. https://dovellabs.si/darwin

This repository is the GitHub Actions workflow Darwin runs in your repository.
You do not add it yourself: install the Darwin GitHub App and merge the one
pull request it opens, which adds `.github/workflows/darwin.yml`:

```yaml
jobs:
  darwin:
    uses: <this repository>/.github/workflows/darwin.yml@<release commit>
    permissions: { contents: read, id-token: write }
```

## What it can and cannot do

- **No secret is stored in your repository.** Each job proves who it is with
  GitHub's own OIDC token, and Darwin issues it short-lived credentials for this
  run only.
- **The job that runs your code holds no token that can write.** It checks out
  your repository read-only, runs your install and tests, and reports what it
  found. Its own GitHub token, read-only (`contents: read`), goes only to the
  runs of your CI jobs, as GitHub gives it to them, so their setup steps can
  look versions up on GitHub's API.
- **Only the publish job can open pull requests**, on a fresh machine that runs
  none of your code, with a token GitHub scopes to your repository alone. Darwin
  confirms with GitHub which job is asking before it issues one.
- **Darwin's engine is downloaded per run** and refused unless its size and
  SHA-256 are exactly what Darwin issued for that run.
- **Darwin's change registry** (what API providers announced: a model retired,
  an endpoint removed, an API version switched off) is downloaded the same way,
  checked by size and SHA-256, before any of your code runs. The run lists what
  of it reaches your code, with file and line, in the job summary. A run
  without one still runs. Where Darwin can change your code for such an
  announcement (a provider fix), the publish job downloads its own copy, checks
  the fix against it, and opens it as a draft for a person to review.
- **Darwin remembers each repository between runs**: what each run attempted
  and what came of it, including which of its pull requests people merged or
  closed (a release you closed is not proposed again), so the next run goes on
  from there. The engine reads and stores that memory on Darwin with the run's
  own token, in steps that run none of your code, and only for this repository
  while the run is going.
- **A run Darwin starts for an API change checks the changed package first**:
  Darwin names the packages your repository's open API changes affect, and the
  run gives them its first places, within the pull requests it may open.
- **Darwin never merges.** Every pull request is a draft until your CI passes on
  it, and a person merges it.

Pin it by commit (`@<sha>`), never by branch or tag: the commit is what Darwin
verifies, and it cannot be moved.
