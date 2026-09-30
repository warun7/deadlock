# Deploying Deadlock

Everything runs on **one server**. One command deploys it.

This document assumes no prior infrastructure knowledge. Follow it top to bottom.

---

## What you are building

```
                        Internet
                            |
                   deadlock.sbs  +  api.deadlock.sbs
                            |
                  +---------v----------+
                  |      edge          |   Caddy: HTTPS certificates, routing
                  +----+----------+----+
                       |          |
          +------------v--+   +---v-------------+
          |   frontend    |   |    backend      |   game server (Socket.IO)
          |  (React SPA)  |   +---+---------+---+
          +---------------+       |         |
                          +-------v--+  +---v-----------------+
                          |  redis   |  |  judge0            |  code execution
                          |          |  |  (server, workers, |
                          +----------+  |   db, redis)       |
                                        +--------------------+

   Off the server (free):  Supabase = database + login accounts
                           Namecheap = DNS
```

Everything inside that box is started by `deploy/docker-compose.yml`.

**Judge0 has no public address.** It is reachable only by the backend, over a
private network inside the server. Nobody on the internet can submit code to it
directly, and there is no certificate or firewall rule needed for it.

---

## Cost

| Item | Cost | Notes |
|---|---|---|
| DigitalOcean droplet, 2 GB / 1 CPU | ~$12/mo | Runs everything in the diagram |
| Supabase | $0 | Free tier: database + auth |
| Namecheap DNS | $0 | You already own the domain |
| Let's Encrypt certificates | $0 | Automatic, via Caddy |
| **Total** | **~$12/mo** | |

`train.csv` and other build inputs never leave your laptop; only built images
run on the server.

If you would rather not run Judge0 on the same box later, it is the only piece
that can be moved off independently — see [Scaling](#scaling-when-you-get-users).

---

## Part 1 — Create the server

1. Log in to DigitalOcean → **Create** → **Droplets**.
2. Choose:
   - **Region:** closest to you (e.g. Bangalore / BLR1)
   - **Image:** **Ubuntu 22.04 LTS** — this is the version Judge0 is tested
     against. Ubuntu 24.04 works only with the extra step in Part 2.
   - **Size:** **Basic → Regular → $12/mo (2 GB RAM / 1 CPU / 50 GB SSD)**
   - **Authentication:** **SSH key**. If you have no key, choose Password and
     use a long one — but an SSH key is safer and simpler.
3. Create it, then copy the **public IP address** shown on the droplet page.

> **Do not pick the $6 (1 GB) droplet.** Judge0 spawns a process per code
> submission and 1 GB will start killing containers under load. 2 GB is the
> honest minimum; 4 GB ($24/mo) is comfortable.

### Point your domain at it

In **Namecheap → Domain List → deadlock.sbs → Manage → Advanced DNS**, delete
any existing A records and add these three:

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `@` | *your droplet IP* | Automatic |
| A Record | `www` | *your droplet IP* | Automatic |
| A Record | `api` | *your droplet IP* | Automatic |

Wait a few minutes. Check it worked, from your laptop:

```bash
dig +short deadlock.sbs
dig +short api.deadlock.sbs
```

Both must print your droplet IP. **If they do not, stop here** — certificates
cannot be issued until they do, and the site will show a security warning.

> There is deliberately no `judge` record. Judge0 is private now.

---

## Part 2 — Set up the server

SSH in (replace with your IP):

```bash
ssh root@YOUR_DROPLET_IP
```

Get the code onto the server. The `deploy/` folder is all that is needed:

```bash
git clone --depth 1 https://github.com/warun7/deadlock.git /opt/deadlock
cd /opt/deadlock/deploy
```

Then run the one-time host setup:

```bash
sudo ./bootstrap.sh
```

This installs Docker, adds 2 GB of swap, enables **cgroup v1** (see below),
turns on the firewall (**only SSH, 80 and 443 are reachable**), and configures
log rotation so logs cannot fill the disk. It is safe to run twice.

### Then reboot — this one is important

```bash
sudo reboot
```

Reconnect after ~30 seconds and confirm:

```bash
ls /sys/fs/cgroup/memory
```

**That directory must exist.** If it does not, run `cat /proc/cmdline` — it
should contain `systemd.unified_cgroup_hierarchy=0`. If it does not, re-run
`sudo ./bootstrap.sh` and reboot again.

#### Why the reboot is needed

Judge0 1.13.1 runs code inside a sandbox called `isolate`, which creates each
sandbox using a **cgroup v1** path: `/sys/fs/cgroup/memory/box-<id>/`.

Ubuntu 22.04 and newer boot with the newer **cgroup v2** layout by default,
where that path does not exist. When it is missing, `isolate` cannot create the
sandbox — and the error you get back is genuinely misleading. Judge0 reports:

```
Internal Error: No such file or directory @ rb_sysopen - /box/script.py
```

which looks like an application bug, or a bad problem statement, or a broken
submission. It is none of those. **Every** submission fails this way, and the
real cause is the host's cgroup version. This is not a quirk of this setup:
it is why Judge0's own documentation instructs you to add
`systemd.unified_cgroup_hierarchy=0` to GRUB and reboot.

`bootstrap.sh` does that edit for you. `deploy.sh` also checks for it before
deploying, so you will get a clear message rather than silent breakage.

---

## Part 3 — Fill in your settings

```bash
cp .env.example .env
nano .env
```

Fill in every blank. Here is where each value comes from:

| Setting | Where to find it |
|---|---|
| `ACME_EMAIL` | Your own email. Let's Encrypt uses it to warn you before certificates expire. |
| `SUPABASE_URL` | Supabase → **Project Settings → API → Project URL** |
| `SUPABASE_ANON_KEY` | Same page → **anon / public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → **service_role** key |
| `SUPABASE_JWT_SECRET` | Same page → **JWT Settings → JWT Secret** |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Same as `SUPABASE_ANON_KEY` |
| `ADMIN_SECRET` | Make one up: run `openssl rand -hex 32` |

`DOMAIN`, `API_DOMAIN` and `VITE_SOCKET_URL` already match `deadlock.sbs` —
leave them unless your domain is different.

> **Why some keys appear twice.** Anything starting with `VITE_` gets baked into
> the JavaScript that browsers download, so it must be public — that is why the
> `anon` key is safe there. The `service_role` key bypasses all database
> security and must **never** go in a `VITE_` setting.

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## Part 4 — Deploy

```bash
./deploy.sh
```

The first run takes 5–10 minutes; it builds the images and downloads Judge0.
The script checks your DNS first and refuses to continue if it is wrong, which
prevents the most common first-boot failure.

When it finishes you will see a health report and your URLs:

```
 Deadlock is deployed
  App:    https://deadlock.sbs
  API:    https://api.deadlock.sbs
```

### One more step: tell Supabase about your domain

Login will not redirect correctly until you do this.

In Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://deadlock.sbs`
- **Redirect URLs:** add `https://deadlock.sbs/**`

If you also use Google login, add `https://deadlock.sbs` to the **Authorized
JavaScript origins** of the OAuth client in Google Cloud Console.

---

## Part 5 — Check it works

Open `https://deadlock.sbs` — you should get a padlock and the landing page.

Then verify the pieces from the server:

```bash
cd /opt/deadlock/deploy

curl localhost:3001/health          # backend + Redis status
curl localhost:2358/about           # Judge0 status
docker compose ps                   # everything should say "running"
```

`/health` returns `"status":"ok"` and `"redis":{"connected":true}` when the
backend can reach Redis. A `503` means Redis is unreachable.

**Then play a real match.** Sign up, join the queue, submit code. This is the
only test that proves Judge0 is working end to end — nothing else exercises it.

---

## Part 6 — Retire the old setup

Do this once the new server is working. Until you do, the old providers are
still live — and Vercel in particular will keep deploying the frontend on every
push, so you would have two frontends running and no idea which one you are
looking at.

| Provider | What to do | Why |
|---|---|---|
| **Vercel** | Delete the project, or disconnect the Git integration | Otherwise it redeploys the frontend on every push |
| **Railway** | Delete the project | The backend now runs on your droplet |
| **Upstash** / Redis Cloud | Delete the database | Redis is now a container on the droplet |
| **Google Cloud Run** | Delete the service if one still exists | Superseded by the droplet |

`frontend/vercel.json` can stay in the repo — it is inert now that Caddy handles
routing — or you can delete it for tidiness.

**Keep Supabase.** It holds your accounts and match history, which is the one
thing you genuinely do not want to migrate by hand.

---

## Day-to-day

Everything is run from `/opt/deadlock/deploy` on the server.

```bash
docker compose ps                    # what is running
docker compose logs -f backend       # follow the game server
docker compose logs -f judge0-server # code execution problems
docker compose restart backend       # restart one service
docker compose down                  # stop everything (data is kept)
docker compose up -d                 # start everything again
```

Data survives `down`/`up` and reboots: Redis state, Judge0's database and your
TLS certificates live in Docker volumes.

### Deploying a code change

```bash
cd /opt/deadlock && git pull && cd deploy && ./deploy.sh
```

Or set up the GitHub Action in `.github/workflows/deploy.yml`, which does
exactly this on every push to `main`. Add three repository secrets first
(**Settings → Secrets and variables → Actions**): `DEPLOY_HOST` (the droplet
IP), `DEPLOY_USER` (`root`), and `DEPLOY_SSH_KEY` (a private key whose public
half is in the droplet's `~/.ssh/authorized_keys`). Generate a dedicated key
rather than reusing your personal one — the workflow file documents the exact
commands.

### Backups

Nothing on this server is irreplaceable — matches and accounts live in Supabase,
which backs itself up. Your Supabase free tier already covers the data that
matters. If you want to be thorough, back up `judge0-db-data` occasionally, but
losing it only costs you submission history, not accounts.

---

## Scaling when you get users

The first thing to run out is code execution, not the web server.

**1. More Judge0 workers.** Each worker handles roughly one submission at a
time. Increase in `deploy/.env` and redeploy:

```
JUDGE0_WORKERS=2
```

Watch memory with `free -h` and `docker stats`. If you are swapping heavily, go
to a 4 GB droplet before adding a third worker.

**2. Bigger droplet.** Resize in the DigitalOcean console (requires a power
off). Everything else stays the same.

**3. Move Judge0 to its own server.** It is the only component that needs
`privileged` containers, and the only one that is CPU-hungry. Split it out by
running the four `judge0-*` services on a second box and pointing `JUDGE0_URL`
in `docker-compose.yml` at it.

**4. The real ceiling.** The matchmaking queue is held **in the process memory**
of a single backend container. Running two backends will not work: players on
different instances would never see each other. Fixing that means moving the
queue into Redis first. Do not add a second backend container until that is done.

---

## Troubleshooting

**Site shows a certificate warning / "not secure"**
DNS is wrong or not propagated. Confirm with `dig +short deadlock.sbs`, then
`docker compose logs edge`. Caddy retries automatically, so once DNS is correct
it usually fixes itself within a few minutes.

**`Failed to connect to server` when joining the queue**
The browser cannot reach the API. Check `FRONTEND_URL` in `.env` matches the
address in your browser bar exactly (including `https://`), then
`docker compose logs backend`. Nothing outside `FRONTEND_URL` is allowed to
connect — that is the CORS allow-list working as intended.

**Submissions hang or immediately fail**
Judge0 is down or still starting. `curl localhost:2358/about` and
`docker compose logs judge0-workers`. Judge0 is the slowest part of the stack to
become ready; it runs its own database migrations on first boot.

**Every submission returns `Internal Error: ... /box/script.py`**
cgroup v1 is not active. This is the single most likely Judge0 failure, and it
is a host problem, not a code problem — see the reboot step in Part 2. Confirm:

```bash
ls /sys/fs/cgroup/memory            # must exist
cat /proc/cmdline                   # must contain systemd.unified_cgroup_hierarchy=0
```

If `/sys/fs/cgroup/memory` is missing, run `sudo ./bootstrap.sh` and reboot.

**Judge0 returns `PG::ConnectionBad: could not connect to server: Connection refused`**
`deploy/judge0.conf` is not readable *inside* the container. Judge0's image runs
as uid 1000 / gid 999, so a root-only `0600` file is invisible to it: its
`load-config` script fails with `Permission denied`, `POSTGRES_HOST` is never
set, and Rails crash-loops trying to reach the default database host.

`deploy.sh` sets the correct ownership automatically. If you created the file by
hand, fix it with:

```bash
cd /opt/deadlock/deploy
sudo chown 1000:999 judge0.conf && chmod 600 judge0.conf
docker compose restart judge0-server judge0-workers
```

Confirm the exact cause in the logs first:

```bash
docker compose logs judge0-server | grep -i "permission denied"
```

Note that Judge0's `/about` endpoint can answer while execution is still broken,
so `curl localhost:2358/about` succeeding does **not** prove it works. Verify
with a real submission instead — `deploy.sh` does this automatically.

**`docker compose ps` shows backend as `unhealthy`**
Redis is unreachable. `curl localhost:3001/health` names which one. Usually just
`docker compose restart redis`.

**Everything is slow / containers keep restarting**
You are out of memory. `free -h` and `docker stats`. Add swap (already handled
by `bootstrap.sh`) or reduce `JUDGE0_WORKERS` to `1`, or resize the droplet.

**Disk full**
`docker system df`, then `docker image prune -a` to clear old build layers.
Container logs are already capped at 10 MB × 3 per service.

**Starting over completely**

```bash
docker compose down -v   # WARNING: deletes Redis data, Judge0 data and certs
./deploy.sh
```
