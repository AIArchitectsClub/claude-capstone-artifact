# Ensuring the k6 binary is available

k6 is a standalone Go binary, not an npm package — `npm install` inside
`k6/` won't provide it. Check for it before anything else, every session
(cheap check, and environments change between sessions):

```
k6 version
```

- **Found** → proceed, note the version in the bootstrap/run report.
- **Not found** → this is an install onto the user's machine, which changes
  system state outside the repo. Don't run an install command silently —
  tell the user k6 isn't found and ask (`AskUserQuestion`) which install
  method to use, offering the platform-appropriate options below as choices,
  then run only the one they pick:

  - **Windows**: `winget install k6 --source winget` (recommended if winget
    is available — check with `winget --version` first), or
    `choco install k6` (if Chocolatey is present), or point the user to
    https://github.com/grafana/k6/releases for a manual download if neither
    package manager is available.
  - **macOS**: `brew install k6`.
  - **Linux**: distro package manager if k6 is in the standard repos, else
    the official install script from k6's own docs
    (`https://k6.io/docs/get-started/installation/`) — don't pipe an
    arbitrary remote script to a shell without showing the user the command
    first.

After installing, re-run `k6 version` to confirm before proceeding — don't
assume the install succeeded just because the command exited 0 (PATH not
refreshed in the current shell is a common false-negative on Windows;
a new terminal/shell restart may be needed, which is worth telling the user
directly rather than looping on a failing check).
