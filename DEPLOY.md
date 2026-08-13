# Deploying the ROFT LMS

For a single Linux server in South Africa running the whole stack: reverse
proxy, application, and PostgreSQL. Suits Oracle Cloud Always Free
(Johannesburg) or any small VPS.

Roughly an hour the first time, most of it waiting for things to install.

---

## What you are building

```
        internet
            |
      [ Caddy ]         TLS certificates, obtained and renewed automatically
            |
       [ app ]          Next.js, unprivileged, no published port
            |
        [ db ]          PostgreSQL, internal network only, never exposed
            |
   nightly backup       database + evidence files, encrypted, copied off the
                        server, restore tested against each other
```

The database is deliberately unreachable from the internet. A Postgres open to
the world is the most common way a small deployment is lost.

---

## Before you start

You need:

- **A server.** 2 vCPU and 8–12 GB is ample. ARM (Ampere) is fine and usually
  cheaper — the image builds for it.
- **A domain.** `lms.roftbusiness.org` is the obvious one. Your existing
  website at `roftbusiness.org` is untouched by any of this.
- **Somewhere to put backups** that is not this server: an object storage
  bucket. Oracle gives 10 GB free and it is S3-compatible.

### Decide the hostname pattern now

Tenants are identified by hostname, so this shapes everything after it:

| Address | Who sees it |
|---|---|
| `lms.roftbusiness.org` | ROFT platform console |
| `acme.lms.roftbusiness.org` | the Acme tenant |
| `learning.acmemining.co.za` | a client using their own domain |

In your DNS, point both `lms` and `*.lms` at the server's IP address. The
wildcard is what lets a new client be added without touching DNS again.

---

## 1. Prepare the server

SSH in, then:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 git postgresql-client awscli
sudo usermod -aG docker $USER
```

Log out and back in so the group membership applies.

**Open only 80 and 443.** On Oracle Cloud this is two places, and forgetting
the second is the usual reason a new instance appears dead:

1. the Security List or Network Security Group in the OCI console, and
2. the instance firewall itself:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## 2. Fetch the code

```bash
git clone https://github.com/Rolbaron001/roft-lms.git
cd roft-lms
```

---

## 3. Write the settings

```bash
cp .env.example .env
nano .env
```

Generate each secret rather than inventing one:

```bash
openssl rand -base64 36   # for POSTGRES_PASSWORD
openssl rand -base64 36   # for ROFT_APP_DB_PASSWORD
npx auth secret           # for AUTH_SECRET
openssl rand -base64 36   # for BACKUP_PASSPHRASE
```

`.env` should contain:

```
LMS_DOMAIN=lms.roftbusiness.org
LMS_TLS_EMAIL=you@roftbusiness.org

POSTGRES_USER=postgres
POSTGRES_PASSWORD=...
POSTGRES_DB=roft_lms
ROFT_APP_DB_PASSWORD=...

AUTH_SECRET=...
```

Then lock it down — it holds every credential the system has:

```bash
chmod 600 .env
```

**Keep `BACKUP_PASSPHRASE` somewhere other than this server.** A password
manager, not a note on the machine. Without it the backups are unreadable, and
that is the entire point of them.

---

## 4. Start it

```bash
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml logs -f app
```

The first build takes a few minutes. Caddy will fetch a certificate as soon as
DNS resolves to this machine; if it fails, DNS has not propagated yet — wait
and check again rather than changing anything.

---

## 5. Create the schema

```bash
docker compose -f docker-compose.production.yml run --rm tools sh -c '
  npx drizzle-kit push --force && npx tsx scripts/apply-policies.ts
'
```

Note `run --rm tools`, not `exec app`. The application image contains only the
built app — no source, no dev dependencies, no scripts directory — so the
operational commands live in a separate one-shot container. Keeping the
internet-facing image minimal is worth the extra word.

It should end with `29 tables are tenant-isolated`. **If it does not, stop.**
That line is the tenant separation everything else depends on.

---

## 6. Create the first tenant and administrator

There is no sign-up page by design — tenants are provisioned, not
self-created. Do it once from the server:

```bash
docker compose -f docker-compose.production.yml run --rm tools npx tsx scripts/seed.mts --allow-remote
```

`--allow-remote` is required because the script refuses to touch a database
that is not local unless you say so. It deletes and recreates the demonstration
tenants, so on a system carrying a real client that flag is the difference
between a demo refresh and a bad afternoon.

That loads the demonstration organisations, which is what you want for
showing the system. For a real client, create their organisation instead and
add one administrator, then everyone else through **People** in the interface.

Confirm it is up:

```bash
curl https://lms.roftbusiness.org/api/health
```

You want `{"status":"ok",...}`.

---

## 7. Set up backups — do not skip this

This is the step that separates a system from a liability. Self-hosted
Postgres without tested backups is the one arrangement not worth running.

Each run produces **two** files, and you need both:

| File | Holds |
|---|---|
| `roft-lms-<stamp>.dump.enc` | the database — every decision, mark and record |
| `roft-lms-<stamp>.evidence.tar.gz.enc` | the files those decisions were made on |

Restoring one without the other gives you a Portfolio of Evidence full of
references to files that no longer exist. In front of an accreditation body
that is worse than having no record, because the record says evidence existed
and cannot produce it. The verify step below checks the two against each other
rather than trusting that they match.

Backups run **through the tools container**, not from the host. The database
has no published port — that is deliberate, and it means the host itself has
no route to it. The tools container is on the internal network and does, and it
mounts the evidence volume too.

Add the backup settings to `.env` (bootstrap-server.sh generates the
passphrase for you):

```
BACKUP_PASSPHRASE=...
BACKUP_BUCKET=s3://your-bucket/roft-lms
BACKUP_S3_ENDPOINT=https://<namespace>.compat.objectstorage.af-johannesburg-1.oraclecloud.com
```

**Keep `BACKUP_PASSPHRASE` somewhere other than this server.** A password
manager, not a note on the machine. Without it every backup is permanently
unreadable, which defeats having them.

Run one by hand and watch it:

```bash
cd ~/roft-lms
docker compose -f docker-compose.production.yml run --rm tools ./scripts/backup.sh --local-only
```

Backups land in `~/roft-lms/backups` on the host. Once your object storage
credentials are configured (`aws configure` inside the tools container, or
mount `~/.aws`), drop `--local-only` and they are copied off the machine too.

Then prove a restore works before trusting any of it:

```bash
docker compose -f docker-compose.production.yml run --rm tools   sh -c './scripts/restore.sh --verify $(ls -t /backups/*.dump.enc | head -1)'
```

You want **VERIFY PASSED**, and above it the line that matters:

```
  12 files referenced by the database, 12 in the archive.
  Every file the database refers to is present.
```

Give it the `.dump.enc` file, not the evidence archive — it finds the matching
evidence beside it. If that check ever reports missing files, the backup is not
usable for an accreditation audit no matter how cleanly the database restores.

Schedule both. `crontab -e`:

```cron
# 02:15 SAST nightly backup
15 0 * * * cd $HOME/roft-lms && docker compose -f docker-compose.production.yml run --rm tools ./scripts/backup.sh >> /var/log/roft-backup.log 2>&1

# Prove a backup restores, on the first of each month
30 1 1 * * cd $HOME/roft-lms && docker compose -f docker-compose.production.yml run --rm tools sh -c './scripts/restore.sh --verify $(ls -t /backups/*.dump.enc | head -1)' >> /var/log/roft-restore-test.log 2>&1
```

**Read `/var/log/roft-restore-test.log` occasionally.** A backup nobody has
restored is a hypothesis. The script exists so that checking is a two-minute
job rather than a project.

---

## 8. Notifications

In-app notifications work immediately with no setup. Email needs a mail
server, and until one is configured the messages queue rather than being lost.

Schedule the sweep either way — in-app reminders depend on it:

```cron
# 07:00 SAST: look for overdue and upcoming training, and send anything queued
0 5 * * * cd $HOME/roft-lms && docker compose -f docker-compose.production.yml run --rm tools npx tsx scripts/notify.mts >> /var/log/roft-notify.log 2>&1

# Hourly: clear anything raised during the day
0 * * * * cd $HOME/roft-lms && docker compose -f docker-compose.production.yml run --rm tools npx tsx scripts/notify.mts send >> /var/log/roft-notify.log 2>&1
```

(Cron runs in UTC on most servers; 05:00 UTC is 07:00 SAST.)

**When you have a mail server**, add to `.env`:

```
MAIL_HOST=smtp.yourprovider.com
MAIL_PORT=587
MAIL_USER=...
MAIL_PASSWORD=...
MAIL_FROM="ROFT Learning <learning@roftbusiness.org>"
```

Then implement the marked block in `lib/mail.ts` — it is about ten lines with
nodemailer. Everything already queued sends on the next run.

Use a proper sending service rather than your own SMTP daemon. Mail from a new
server's IP address goes to spam, and a learner who never sees a reminder is
worse than one who was never sent it.

---

## Everyday operations

**Deploy a change:**

```bash
cd roft-lms && git pull
docker compose -f docker-compose.production.yml up -d --build app tools
```

Build `tools` as well as `app`. The tools image copies the source in at build
time, so until you rebuild it, migrations and scripts run the version of the
code that was current when it was last built — which looks like your change
simply having no effect.

**Apply a schema change** (after the deploy above):

```bash
docker compose -f docker-compose.production.yml run --rm tools sh -c '
  npx drizzle-kit push --force && npx tsx scripts/apply-policies.ts
'
```

Note `run --rm tools`, not `exec app`. The application image contains only the
built app — no source, no dev dependencies, no scripts directory — so the
operational commands live in a separate one-shot container. Keeping the
internet-facing image minimal is worth the extra word.

Re-running the policies script after any schema change is not optional. A new
table without its policy is a table with no tenant separation.

**Look at the database:**

```bash
docker compose -f docker-compose.production.yml exec db psql -U postgres -d roft_lms
```

**Read the logs:**

```bash
docker compose -f docker-compose.production.yml logs -f --tail=100 app
```

**Restore after a disaster:**

```bash
cd ~/roft-lms
DC="docker compose -f docker-compose.production.yml run --rm tools"

# Bring BOTH halves down from object storage into ./backups
$DC sh -c 'aws s3 cp $BACKUP_BUCKET/roft-lms-<stamp>.dump.enc /backups/ --endpoint-url $BACKUP_S3_ENDPOINT'
$DC sh -c 'aws s3 cp $BACKUP_BUCKET/roft-lms-<stamp>.evidence.tar.gz.enc /backups/ --endpoint-url $BACKUP_S3_ENDPOINT'

$DC ./scripts/restore.sh --verify /backups/roft-lms-<stamp>.dump.enc
$DC ./scripts/restore.sh --replace-production /backups/roft-lms-<stamp>.dump.enc
docker compose -f docker-compose.production.yml run --rm tools npx tsx scripts/apply-policies.ts
```

Fetch both files. `--replace-production` refuses to start without the evidence
archive rather than rebuilding the database and discovering the files are
missing afterwards — by which point it has already discarded the one copy that
had both.

Always `--verify` before `--replace-production`. The replace takes a safety
copy of the current database *and* the current evidence first, but checking
costs a minute and removes the possibility of restoring the wrong file over a
working system.

Restoring evidence **adds** files rather than replacing the directory, so
anything uploaded since the backup survives. Evidence is write-once and
content-hashed, so there is nothing to gain from deleting files the restored
database has not heard of — and a recent upload is exactly what you would not
want thrown away.

---

## If you are on Oracle Cloud Always Free

Two things specific to it, both of which have cost people their servers:

**Upgrade the account to Pay As You Go.** Idle Always Free instances are
reclaimed after roughly seven days of low usage, and a demonstration system
with a handful of users looks exactly like an idle one. Upgrading keeps the
same free resources and stops the reclamation. You stay within Always Free
limits and are not charged.

**The free ARM allowance was halved in June 2026** to 2 cores and 12 GB.
Still ample here — but if you read an older guide promising 4 cores and 24 GB,
that is no longer available and instances exceeding the new limit are being
terminated.

If instance creation reports "out of host capacity", that is normal for free
ARM. Try a different availability domain, or retry over a day or two.

---

## Before a real client's data goes on this

- [ ] Restore tested from an off-server copy, not just a local one
- [ ] `BACKUP_PASSPHRASE` stored somewhere other than this server
- [ ] The demonstration tenants removed, or renamed so nobody mistakes them
- [ ] `roft-demo-2026` no longer a working password anywhere
- [ ] Uptime monitoring pointed at `/api/health`
- [ ] Unattended security upgrades enabled (`apt install unattended-upgrades`)
- [ ] Somebody other than Roland able to reach the server if he is unavailable
