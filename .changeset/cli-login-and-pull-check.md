---
"notcms": minor
---

Add browser login to the CLI and a CI check mode for pull

- `notcms login`: opens the dashboard in the browser, mints a secret key for the selected workspace, and saves `NOTCMS_SECRET_KEY` / `NOTCMS_WORKSPACE_ID` to an env file (default `.env.local`)
- `notcms init`: offers to log in via browser when credentials are missing
- `notcms pull --check`: verifies the local schema is up to date without writing (exits 1 when stale, for CI/CD)
- `notcms --version` now reports the actual version from package.json
- The CLI now exits with code 1 on unhandled errors (previously errors were logged but the process exited 0)
- Env files written by login are kept owner-only (0600): new files are created with that mode, and existing files with group/other access are tightened after the secret is written (POSIX only)
