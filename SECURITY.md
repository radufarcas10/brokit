# Security

brokit runs a browser, opens pages, serves files and writes screenshots on your
computer and on CI runners, so security reports are very welcome.

## Reporting a vulnerability

Please **do not open a public issue**. On GitHub, use the private **Report a
vulnerability** form in the repository's Security tab; on GitLab, open a
**confidential** issue. Include the brokit, Node and Chrome versions, your operating
system, and steps to reproduce. You should get a reply within a week.

## What brokit promises

**The browser**
- Chrome runs headless with a throwaway profile, deleted when brokit is done, and with
  its sandbox on. `--no-sandbox` as a Chrome flag is always refused.
- The one exception is yours to make: `BROKIT_NO_SANDBOX=1` turns Chrome's sandbox off,
  for containers whose settings forbid it and can't be changed (GitLab.com shared
  runners, GitHub jobs in a container). brokit honors it **only inside a container**
  (Docker, Podman, Kubernetes, LXC), where the container keeps Chrome apart from the
  computer; anywhere else it refuses. With the sandbox off, brokit opens only pages on
  this computer (`--allow-host` is refused), and says so on every run.
- brokit talks to Chrome over a pipe that only it holds. Chrome opens no debugging port,
  so no other program or user on the computer can connect to it.
  (`BROKIT_CHROME_TRANSPORT=port` uses a port on 127.0.0.1 instead, for browser builds
  that can't do pipes; anything on the computer could connect to that port while it's
  open.)
- Chrome and V8 flags passed through must look like flags; the ones that would weaken
  the above are refused. Every call to Chrome has a timeout, and Chrome is killed when
  brokit exits.

**Pages**
- brokit opens only `http` and `https` pages on this computer (`localhost`, `127.0.0.1`,
  `[::1]`, `*.localhost`) unless you name another host with `--allow-host`.

**The file server** (`brokit serve`, and the one `run` and `check` start)
- Listens on 127.0.0.1 only and answers only requests addressed to it (which blocks
  DNS-rebinding pages).
- Serves only files inside its folder: no `..`, no symbolic links leading out, no
  dotfiles (`.env`, `.git`), no directory listings, `GET` and `HEAD` only.

**Files**
- Screenshot and baseline names can't leave their folder (no paths, no `..`).
- PNG files (baselines, `brokit diff` inputs) are treated as untrusted: chunk bounds and
  checksums are checked and image sizes capped before anything is allocated. Scenario
  and steps files are capped at 10 MB, and so is what Chrome may send in one message
  (512 MB).
- brokit has no npm dependencies: there is no third-party JavaScript to audit. It needs
  Node.js and Chrome, and trusts them.

**Downloads** (`brokit install-chrome` only: brokit downloads nothing on its own)
- Only Google's Chrome for Testing: the version list from `googlechromelabs.github.io`
  and the build from `storage.googleapis.com`, over HTTPS; a redirect anywhere else is
  refused. Downloads are capped at 600 MB.
- The download is checked against the MD5 that Google's storage sends with it, and
  every file in it against its CRC-32 as it's unpacked. Google publishes no signed
  checksums for these builds, so beyond that the guarantee is HTTPS to Google's servers.
- Unpacking treats the archive as untrusted: nothing lands outside brokit's cache
  folder (no `..`, no absolute paths, no links pointing out), no entry may unpack past
  its declared size, and entries and total size are capped. A build is moved into place
  only once it's whole.

## What is your own code

- **JS scenarios (`*.check.mjs`) are code.** `brokit check` runs them with Node, with
  your permissions, the same way a test runner runs test files. Don't run `brokit check`
  on a checkout you don't trust, or run it with `--no-js`, which runs only JSON
  scenarios.
- JS expressions in steps (`eval`, `expect`, `waitFor`, points, `ready`) run inside the
  page, in Chrome's sandbox, with the page's permissions.

## Out of scope

- Pages you allow with `--allow-host` are web content like any other: they run in
  Chrome's sandbox, but they can see whatever the page shows them.
- What a page can do inside a container where you've set `BROKIT_NO_SANDBOX`: Chrome's
  sandbox is off there by your choice, and the container is what keeps it apart from the
  computer.
