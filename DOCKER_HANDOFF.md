# BOOMART — Docker handoff (private / organizers)

This directory contains four new files to place in the root of the **existing** BOOMART project. It is not a complete application and does not include any application source, flags, environment files or SQLite databases.

## Prerequisites

- Docker Desktop with Linux containers enabled on Windows 11 (or Docker Engine and Compose plugin on Linux).
- Original BOOMART repository containing `package.json`, `package-lock.json`, `src/`, `public/`, `views/`, and `test/`.
- `npm test` passing on Node.js 24 before building.

## Step 1 — Run a fresh isolated test inside Docker

Open PowerShell in `C:\dev\boomart`:

```powershell
docker build --target test -t boomart-ctf:test .
docker run --rm boomart-ctf:test
```

This runs the integration tests with a temporary database and dummy flag, without writing to your development database. Stop if it fails.

## Step 2 — Choose LOCAL TEST variables (not the competition flag)

```powershell
$env:FLAG = 'HAUNTED{DOCKER_TEST_ONLY}'
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$env:SESSION_SECRET = [Convert]::ToBase64String($bytes)
$env:COOKIE_SECURE = '0'
$env:TRUST_PROXY = '0'
```

`COOKIE_SECURE=0` is strictly for **local HTTP** at `127.0.0.1`. For deployment behind correctly configured HTTPS reverse proxy, use `COOKIE_SECURE=1` and configure `TRUST_PROXY` to match the proxy topology. Do not expose raw HTTP to the public Internet.

## Step 3 — Build and run

```powershell
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=40
```

Open `http://127.0.0.1:3000` and `http://127.0.0.1:3000/health`. The latter should show `{"status":"ok","application":"BOOMART"}`.

Log in using the CTF starter account `hmar_lill` / `nightshift-13` and perform your manual attack-chain acceptance check. Do **not** distribute the author walkthrough to blind testers.

## Step 4 — Stop / reset

```powershell
docker compose down
```

`down` preserves the named SQLite data volume. To make an absolutely fresh instance, **this destroys the instance's orders, sessions, passwords, approvals, and database**:

```powershell
docker compose down -v
```

A new `docker compose up -d` then initializes new SQLite state. Never reset a live team's container without approval.

## Step 5 — Distribute safely

### Friends (blind testing)

Prefer giving friends a URL to a dedicated HTTPS instance, not source code, a Docker image, the author walkthrough or the production flag. Anyone with the image can extract its JavaScript code; obfuscation is not a security boundary.

If a friend needs to run Docker **locally** (not truly blind):

```powershell
docker save -o boomart-ctf-1.0.0.tar boomart-ctf:1.0.0
```

Share the TAR privately. On the friend's machine:

```powershell
docker load -i .\boomart-ctf-1.0.0.tar
```

Give them `compose.yaml` too. After they set their own **throwaway** `FLAG` and random `SESSION_SECRET` in PowerShell as in Step 2, they run:

```powershell
docker compose up -d --no-build
```

The `--no-build` switch uses the loaded image without requiring source code. They can visit `http://127.0.0.1:3000`. Remember that a Docker image can be inspected to extract application code, so this is **not** a truly blind test. Avoid sharing an image built with real flag values baked into it.

### Organizers

Share a private Git repository with application source plus these Docker files, or send the image TAR privately. The `FLAG` and `SESSION_SECRET` must be supplied when each instance starts, not in Git or an image layer. The organizer must verify one-instance-per-team isolation, HTTPS proxy behavior, rate limits, memory/CPU limits, SQLite volume lifecycle, and CTFd flag checking.

## Expected production startup contract

- `NODE_ENV=production` (requires `FLAG` and `SESSION_SECRET`)
- `HOST=0.0.0.0`, `PORT=3000`
- `DB_PATH=/app/data/boomart.sqlite` (writable volume, non-root Node user)
- `FLAG`: arbitrary competition format (can be changed by restarting with a new environment setting)
- `SESSION_SECRET`: independently generated, at least 32 characters
- `COOKIE_SECURE=1` only with correctly configured TLS/reverse proxy
- `TRUST_PROXY=1` only if one trusted proxy forwards requests with sanitized forwarding headers

**Never** copy development SQLite data, `.env`, or the actual competition flag into Docker build context. `docker compose config` and environment-inspection commands can display secret values, so do not publish their output.

## Git history checks

Check `git status --short` and verify that `git ls-files` does not include `data/`, `.env`, `.sqlite` or old private credentials. If any secret has ever entered Git history, rotate it before sharing. Keep the CTF solution/write-up in a separately permissioned document.
