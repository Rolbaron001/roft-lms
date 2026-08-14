# ROFT Learning Management System — Hosting Requirements

**Prepared for:** InspireTec
**Prepared by:** ROFT Strategic Workforce Advisory
**Date:** 14 August 2026

---

## Summary

The ROFT LMS is a single Next.js application with a PostgreSQL database,
packaged as Docker containers. It currently runs on one Oracle Cloud instance
in London and is being moved to InspireTec so that learner data is held in
South Africa.

Everything below describes what it needs. The short version:

| | |
|---|---|
| **One Ubuntu 24.04 LTS server** | 2 vCPU, 8 GB RAM, 80 GB disk |
| **Docker and Docker Compose** | The only packages that must be installed |
| **Ports open inbound** | 22, 80, 443, and **25** (see the note on mail) |
| **Ports open outbound** | 587 (mail relay) |
| **Public IP and DNS** | Yes, with a wildcard record |
| **Database** | PostgreSQL 18, runs on the same server in a container |
| **Other services** | None. No Redis, no message queue, no external APIs |

The application is already containerised and running in production. Nothing
needs to be re-architected for the move.

---

## Stack and runtime

### Language, runtime and versions

| Component | Version | Notes |
|---|---|---|
| Node.js | **24.x** (Alpine) | Supplied inside the container image |
| PostgreSQL | **18** (Alpine) | Supplied inside the container image |
| Next.js | 16.3 | Application framework |
| React | 19.2 | |

**Nothing needs installing on the host.** Node and PostgreSQL are inside the
container images. The host needs only Docker, Docker Compose and Git.

### Application dependencies

Twelve runtime packages, all installed automatically during the container
build:

```
bcryptjs      password hashing
drizzle-orm   database access
fflate        reads .docx / .xlsx uploads
mailparser    parses inbound email
next          web framework
nodemailer    outbound email
postgres      PostgreSQL driver
react         user interface
react-dom     user interface
server-only   build-time safety check
smtp-server   inbound mail server
zod           input validation
```

### System packages

On the **host**: `docker.io`, `docker-compose-v2`, `git`. That is the whole
list.

Inside the maintenance container, installed automatically during the build:
`postgresql18-client`, `openssl`, `bash`, `aws-cli` — used for backups and
database migrations.

### Operating system

**Ubuntu 24.04 LTS** is what it runs on today and what we would prefer.

Any Linux with Docker will work — the containers are distribution-independent
and build for both x86-64 and ARM64. If InspireTec's standard build is Debian
or Rocky, that is fine; only the two or three package-installation commands in
the setup script change.

---

## Server requirements

### Web server and process manager

**Neither Nginx nor Apache is needed.** The stack includes **Caddy**, which
runs as one of the containers and does three jobs:

- terminates HTTPS
- obtains and renews TLS certificates from Let's Encrypt automatically
- reverse-proxies to the application

Certificates are issued **on demand per hostname**, which is how new client
subdomains work without touching configuration. If InspireTec would rather
terminate TLS at their own edge, that is possible, but Caddy's automatic
renewal is one of the things that makes this system low-maintenance and we
would rather keep it.

**No process manager is needed** — no PM2, no systemd units, no Gunicorn.
Docker Compose restarts containers on failure and on boot (`restart:
unless-stopped`).

### CPU and memory

| | CPU | RAM |
|---|---|---|
| **Minimum** | 2 vCPU | 4 GB |
| **Recommended** | 2 vCPU | 8 GB |
| **Currently running on** | 2 vCPU | 11 GB |

Measured on the live server under normal load: **1.5 GB RAM in use** across all
five containers.

The 8 GB recommendation is headroom for the container build, which is the
heaviest thing that happens. A build on 4 GB works but is slow.

### Disk

| | |
|---|---|
| **Minimum** | 40 GB |
| **Recommended** | 80 GB |

Measured today: **16 GB used of 45 GB**, of which roughly 3.3 GB is container
images.

The number that grows is uploaded evidence. Learners submit photographs,
documents and — occasionally — video of practical assessments, and these must
be retained for the statutory period. Per active learner, allow **200–500 MB**.
For 200 learners that is 40–100 GB, so **plan to be able to grow the disk**,
or expect to move evidence to object storage within the first year.

Encrypted database backups also live on the disk (currently ~150 KB each,
retained 30 days) until they are copied off-server.

---

## Database and services

### Database

**PostgreSQL 18**, running in a container **on the same server**.

It is deliberately not exposed to the network — no published port, on an
internal Docker network only. Nothing outside the application can reach it.

**If InspireTec offers a managed PostgreSQL service**, we would consider it,
subject to two hard requirements:

1. **PostgreSQL 15 or later**, because the platform relies on row-level
   security policies for tenant isolation.
2. **The ability to create a second, non-owner database role.** The application
   connects as a restricted role that the security policies bind; migrations
   use a separate owner role. This separation is what makes one client's data
   unreachable from another client's session, and it is not optional.

If a managed service can do both, it is a genuine improvement (backups and
patching become InspireTec's). If not, the container is fine and is what runs
today.

### Other services

**None.** No Redis, no message queue, no search engine, no external APIs.

Background work — nightly backups, notification sweeps — runs from `cron` on
the host, invoking a one-shot container. There is nothing else to install or
monitor.

The only external dependency is an **outbound SMTP relay** for sending email
(see Networking).

---

## Networking

### Ports

**Inbound:**

| Port | Protocol | Purpose |
|---|---|---|
| 22 | TCP | SSH administration |
| 80 | TCP | HTTP — redirects to HTTPS, and serves Let's Encrypt challenges |
| 443 | TCP + UDP | HTTPS (UDP for HTTP/3) |
| **25** | TCP | **Inbound email** — see below |

**Outbound:**

| Port | Purpose |
|---|---|
| 587 | Authenticated SMTP relay for sending email |
| 443 | Certificate issuance, and container image pulls |

### The two mail questions we need answered

These matter more than anything else on this list, because they determine
whether the platform's email works.

**1. Is inbound port 25 permitted?**

The platform runs its own mail receiver. Learners and assessors are issued
addresses on our domain (`n.mahlangu@acme.lms.roftbusiness.org`) and
correspondence about an assessment is filed against the learner's record
rather than sitting in a personal inbox — which matters for accreditation
audits.

The receiver accepts mail **only for addresses the platform has issued** and
refuses everything else during the SMTP conversation, so it is not an open
relay and does not accept unfiltered spam. This has been independently
verified.

**2. Is outbound port 25 blocked, and can you set a reverse DNS (PTR) record?**

On Oracle, outbound port 25 is blocked on every instance, so the platform sends
through an authenticated relay on port 587. That arrangement works and we are
content to keep it.

But if InspireTec permits outbound 25 **and** can set a PTR record for the
server's IP, direct delivery becomes possible and removes a third-party
dependency. Please tell us which of the two you can offer.

### Public IP, domain and TLS

- **A static public IPv4 address** is required — DNS points at it directly, and
  the mail receiver needs a stable address.
- **DNS is managed by ROFT** at the registrar. We will point records at
  whatever IP you allocate.
- **TLS is handled by the platform**, via Caddy and Let's Encrypt. No
  certificate needs purchasing, installing or renewing.

DNS records we will set, for reference:

```
A      lms.roftbusiness.org      → <new server IP>
A      *.lms.roftbusiness.org    → <new server IP>
MX     lms.roftbusiness.org      → lms.roftbusiness.org   (priority 10)
MX     *.lms.roftbusiness.org    → lms.roftbusiness.org   (priority 10)
```

The wildcard is how each client gets their own branded address
(`acme.lms.roftbusiness.org`) without a DNS change per client.

---

## Deployment

### Docker, or directly on the server?

**Docker, and it is already containerised.** Five containers:

| Container | Purpose |
|---|---|
| `caddy` | HTTPS and reverse proxy |
| `app` | The application |
| `db` | PostgreSQL |
| `mail` | Inbound mail receiver |
| `tools` | One-shot: migrations, backups, scheduled jobs |

Running directly on the host is possible but would mean installing and pinning
Node 24 and PostgreSQL 18 by hand, managing them with systemd, and rebuilding
that arrangement on every future server. The containers already exist, are
tested, and make the move reproducible.

### Step-by-step: fresh Ubuntu server

All commands run as a normal user with `sudo` rights, not as root.

**1. Install what is needed**

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER
```

Log out and back in so the group membership applies.

**2. Open the firewall**

```bash
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 25 -j ACCEPT
sudo netfilter-persistent save
```

If there is also a firewall in front of the server, the same four ports (22,
25, 80, 443) must be allowed there. On our current host, forgetting the second
firewall was the single most common cause of "the server appears dead".

**3. Fetch the application**

The repository is **private**. ROFT will provide either a read-only deploy key
or a release archive — please say which you prefer.

```bash
git clone https://github.com/Rolbaron001/roft-lms.git
cd roft-lms
```

**4. Create the settings file**

```bash
cp .env.example .env
nano .env
```

Generate each secret rather than inventing one:

```bash
openssl rand -base64 36   # POSTGRES_PASSWORD
openssl rand -base64 36   # ROFT_APP_DB_PASSWORD
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 36   # BACKUP_PASSPHRASE
```

Then lock it down — it holds every credential the system has:

```bash
chmod 600 .env
```

**5. Start it**

```bash
docker compose -f docker-compose.production.yml up -d --build
```

The first build takes several minutes.

**6. Create the database schema and security policies**

```bash
docker compose -f docker-compose.production.yml run --rm tools sh -c '
  npx drizzle-kit push --force && npx tsx scripts/apply-policies.ts
'
```

This must end with `43 tables are tenant-isolated`. **If it does not, stop and
tell us.** That line is the tenant separation the whole platform depends on.

**7. Restore ROFT's existing data**

We will supply an encrypted database dump and an encrypted evidence archive,
plus the passphrase separately.

```bash
docker compose -f docker-compose.production.yml run --rm tools \
  ./scripts/restore.sh --verify /backups/roft-lms-<stamp>.dump.enc

docker compose -f docker-compose.production.yml run --rm tools \
  ./scripts/restore.sh --replace-production /backups/roft-lms-<stamp>.dump.enc

docker compose -f docker-compose.production.yml run --rm tools \
  npx tsx scripts/apply-policies.ts
```

`--verify` restores into a scratch database and checks that every evidence file
the database refers to is actually present in the archive. Always run it
first.

**8. Schedule the background jobs**

```cron
# 02:15 SAST — nightly encrypted backup
15 0 * * * cd $HOME/roft-lms && docker compose -f docker-compose.production.yml run --rm tools ./scripts/backup.sh >> $HOME/logs/backup.log 2>&1

# 03:30 SAST on the 1st — prove the newest backup still restores
30 1 1 * * cd $HOME/roft-lms && docker compose -f docker-compose.production.yml run --rm tools sh -c './scripts/restore.sh --verify $(ls -t /backups/*.dump.enc | head -1)' >> $HOME/logs/restore-test.log 2>&1

# 07:00 SAST — training reminders
0 5 * * * cd $HOME/roft-lms && docker compose -f docker-compose.production.yml run --rm tools npx tsx scripts/notify.mts >> $HOME/logs/notify.log 2>&1

# Hourly — send anything queued
0 * * * * cd $HOME/roft-lms && docker compose -f docker-compose.production.yml run --rm tools npx tsx scripts/notify.mts send >> $HOME/logs/notify.log 2>&1
```

Cron runs in UTC; 05:00 UTC is 07:00 SAST.

**9. Confirm**

```bash
curl https://lms.roftbusiness.org/api/health
```

Expect `{"status":"ok","databaseMs":0}`.

### Environment variables

One file, `.env`, in the application directory, `chmod 600`.

**Required — the platform will not start without these:**

| Variable | Purpose |
|---|---|
| `LMS_DOMAIN` | The main hostname, e.g. `lms.roftbusiness.org` |
| `LMS_TLS_EMAIL` | Address Let's Encrypt sends certificate expiry warnings to |
| `POSTGRES_USER` | Database owner role, normally `postgres` |
| `POSTGRES_PASSWORD` | Its password |
| `POSTGRES_DB` | Database name, normally `roft_lms` |
| `ROFT_APP_DB_PASSWORD` | Password for the restricted application role |
| `AUTH_SECRET` | Signs session cookies. Changing it signs everyone out |

**Required for backups:**

| Variable | Purpose |
|---|---|
| `BACKUP_PASSPHRASE` | Encrypts every backup. **Must be stored off this server** — without it the backups are permanently unreadable |
| `BACKUP_BUCKET` | Object storage destination, e.g. `s3://bucket/roft-lms` |
| `BACKUP_S3_ENDPOINT` | S3-compatible endpoint for that bucket |

**Email:**

| Variable | Purpose |
|---|---|
| `MAIL_HOST`, `MAIL_PORT` | Outbound relay. Port 587 |
| `MAIL_USER`, `MAIL_PASSWORD` | Relay credentials |
| `MAIL_FROM` | From address, e.g. `ROFT Learning <learning@roftbusiness.org>` |
| `MAIL_DOMAIN` | Domain that inbound mailboxes live on |

**Optional:**

| Variable | Purpose |
|---|---|
| `DATABASE_POOL_MAX` | Database connections, default 10 |
| `PLATFORM_ORG_SLUG` | Which tenant is the platform owner, default `roft` |
| `MAIL_MAX_BYTES` | Largest inbound message, default 25 MB |
| `STORAGE_DRIVER` | `local` today; `s3` when evidence moves to object storage |

No other configuration files need editing. `Caddyfile` and
`docker-compose.production.yml` are in the repository and read these values.

---

## Operations

### Logging

Container logs go to Docker's default JSON driver and are read with:

```bash
docker compose -f docker-compose.production.yml logs -f --tail=100 app
```

**Please cap them.** Without a limit they grow until the disk is full. Add to
`/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

Caddy writes its own rotating access log inside its volume. **These logs are
personal information under POPIA** — they contain learner email addresses and
tenant hostnames — so they are deliberately short-lived and rotated, and should
not be shipped anywhere without telling us.

The application also keeps an **append-only audit log inside the database**,
covering every consequential action: sign-ins, assessment decisions,
moderation, certificate issue, and personal-data erasure. A database trigger
blocks updates and deletes on it for every role including the owner. This is
part of the accreditation evidence and must not be trimmed.

### Monitoring

**Minimum:** an uptime check against
`https://lms.roftbusiness.org/api/health` every few minutes. It returns
`{"status":"ok"}` only if the application can reach the database, so it
detects a failed database as well as a failed application — a check that only
pings the front page would not.

**Also worth alerting on:**

| Check | Why |
|---|---|
| Disk above 80% | Evidence uploads grow steadily and silently |
| Any container not running | `docker compose ps` |
| TLS certificate expiry | Caddy renews automatically; an alert catches it not doing so |
| Nightly backup log | A backup that stopped running is invisible otherwise |

If InspireTec has a standard monitoring stack, we are happy to use it.

### Backups and persistent storage

**Three things must survive the server:**

| What | Where | Size today |
|---|---|---|
| PostgreSQL database | Docker volume `pgdata` | 12 MB |
| Uploaded evidence and documents | Docker volume `evidence` | Small; grows steadily |
| TLS certificates | Docker volume `caddy_data` | Trivial; regenerates itself |

The nightly job produces **two encrypted files** — the database and the
evidence — and they are pruned together, so a surviving database can never
outlive the evidence it refers to.

**The evidence archive matters as much as the database.** A database restored
without it produces a Portfolio of Evidence full of references to files that no
longer exist, which in front of an accreditation body is worse than having no
record at all.

**Off-server storage is required.** A backup on the same disk as the data is a
second copy, not a backup. We need an S3-compatible bucket — InspireTec's own,
or we will supply credentials for one.

**The monthly restore test is not optional.** It restores the newest backup
into a scratch database and checks every evidence file it refers to is present.
It is already scheduled. A backup nobody has restored is a hypothesis.

---

## Questions for InspireTec

1. **Is inbound port 25 permitted?** Without it, learners and assessors cannot
   receive mail at their platform addresses.
2. **Is outbound port 25 blocked, and can you set a reverse DNS (PTR) record?**
   This determines whether we keep relaying mail through a third party.
3. **Do you offer managed PostgreSQL 15+ where we can create a second,
   non-owner role?** If so we would consider it; if not, the container is fine.
4. **Do you provide S3-compatible object storage** for off-server backups?
5. **Can the disk be grown later** without rebuilding the server?
6. **Which do you prefer for source access** — a read-only deploy key on the
   server, or a release archive?

---

## Contact

Roland Jones — ROFT Strategic Workforce Advisory
roland@roftbusiness.org

The current server, its configuration and its data are available for
inspection at any point during the move.
