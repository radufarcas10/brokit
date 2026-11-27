# CI and containers

The checks you run on your computer run unchanged in CI: `npx brokit check`, which exits
1 when something failed. This page has recipes for GitHub Actions, Docker and GitLab CI,
and what to know about baselines, Chrome's sandbox and AI agents.

Run `npx brokit doctor` first wherever brokit is new: it says what's missing and how to
add it. A failing check leaves its screenshots and difference images in `brokit-out/`;
keep that folder as the job's artifact, so you can see what changed.

## Baselines in CI

- **A missing baseline fails in CI.** Where the `CI` variable is set (GitHub, GitLab and
  most others set it), brokit writes no new baselines: a check with nothing to compare
  with checks nothing. Commit the baselines with the checks.
- **Make baselines where CI runs.** Screenshots match only where the operating system,
  its fonts and the Chrome version are the same. Make and update baselines in the same
  container image CI uses (see [Docker](#docker)), or in a CI job that uploads them.
- **Pin Chrome.** `brokit install-chrome --pin` writes a Chrome version into
  package.json; `npx brokit install-chrome` in CI installs exactly that one.
- **Draw in software.** `brokit check` draws with `--gpu software` unless told
  otherwise, so the GPU of the machine doesn't change the pixels.

## GitHub Actions

GitHub's hosted Linux, macOS and Windows runners come with Chrome, and run jobs on a
virtual machine, not in a container, so Chrome's sandbox works as it is. (This recipe
hasn't been verified on GitHub yet.)

```yaml
name: checks
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx brokit check
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: brokit-out
          path: brokit-out/
```

With a pinned Chrome, install it before the checks, and cache brokit's download:

```yaml
      - uses: actions/cache@v4
        with:
          path: ~/.cache/brokit
          key: brokit-chrome-${{ hashFiles('package.json') }}
      - run: npx brokit install-chrome
      - run: npx brokit check
```

Against your app's dev server, start it first and point brokit at it:

```yaml
      - run: npm run dev &
      - run: npx brokit check --base http://localhost:5173/
```

Give the checks a `ready` signal (or a first `waitFor` step) so they wait for the server
to answer.

## Docker

Verified on 2026-10-27 with `node:22-bookworm-slim` and Debian's Chromium:

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /home/node/app
COPY --chown=node . .
RUN npm ci
CMD ["npx", "brokit", "check"]
```

```sh
docker build -t my-checks .
docker run --security-opt=seccomp=unconfined my-checks
```

Two things are required, and brokit says so when they're missing:

- **A user that isn't root.** Chrome won't sandbox as root; Node images have the user
  `node`.
- **Container settings that allow Chrome's sandbox.** Docker's default seccomp profile
  forbids the namespaces it needs, so the container runs with
  `--security-opt=seccomp=unconfined` (or `--cap-add=SYS_ADMIN`).

To make or update baselines in the same image CI uses, run `npx brokit check --update`
in a container of that image and copy the `baselines` folders out of it (`docker cp`), or
let a CI job run it and keep the baselines as an artifact.

### Where the container's settings can't be changed

Some CI systems run every job in a container whose settings you can't change: GitLab.com's
shared runners, GitHub jobs that run in a `container:`. There, set
`BROKIT_NO_SANDBOX=1`. Chrome then runs without its sandbox, inside the container, which
keeps it apart from the computer. brokit honors it only inside a container, opens only
pages on this computer with it, and says so on every run; root is fine then. (Verified on
2026-10-27 in Docker with default settings, as root and as `node`.) See
[SECURITY.md](../../SECURITY.md).

## GitLab CI

Jobs run in a container, so the runner must allow Chrome's sandbox. On a runner you
manage, set it in its `config.toml` (this recipe hasn't been verified on GitLab yet):

```toml
[runners.docker]
  security_opt = ["seccomp=unconfined"]
```

```yaml
check:
  image: node:22-bookworm-slim
  before_script:
    - apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation
    - npm ci
    - chown -R node .
  script:
    - su node -c "npx brokit check"
  artifacts:
    when: on_failure
    paths: [brokit-out/]
```

GitLab.com's shared runners don't let a job change its container's settings, so Chrome's
sandbox can't start there; run without it:

```yaml
check:
  image: node:22-bookworm-slim
  variables:
    BROKIT_NO_SANDBOX: "1"   # in this container only; see SECURITY.md
  before_script:
    - apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation
    - npm ci
  script:
    - npx brokit check
  artifacts:
    when: on_failure
    paths: [brokit-out/]
```

## AI agents

An AI coding agent can use brokit to see and use what it builds: open a page, click
through it, read values and look at screenshots.

- **Set up:** `npx brokit doctor --json` says what's missing, as data. On a developer's
  computer Chrome is usually there already. In a cloud sandbox,
  `npx brokit install-chrome` brings Chrome if the sandbox allows downloads, and the
  container notes above apply.
- **Use a page:** `brokit run page.html --steps steps.json --json` (or `--out shot.png`)
  gives each step's result, `eval` values, the console and the page's errors as JSON,
  and screenshots as files the agent can look at.
- **Check its work:** `brokit check --json` after a change says what broke.

A prompt that works well: *"After changing the UI, run `npx brokit run <page> --out
shot.png --json`, read the JSON for console errors, and look at shot.png before saying
you're done."*
