# Sites a server adds for itself

The Caddyfile is shared by every deployment of the platform, so it cannot name
one operator's hostnames. Anything a particular server serves beyond the
platform and its tenants goes here, as a `*.caddy` file, and is imported by the
Caddyfile at start and on every reload.

Nothing here is committed except this file. Each `*.caddy` belongs to the server
it was written on, and `.gitignore` keeps it out of the repository.

## What uses it

**The development site**, since 24 September 2026. `scripts/setup-development.sh`
writes `development.caddy` on Curiosa's server, which sends
`lms.roftbusiness.org` to the development application:

```
lms.roftbusiness.org {
	import lms app-dev:3000
}
```

`lms` is the snippet in the Caddyfile, and its argument is the application the
site sends requests to. Using the same snippet as live means a security header
added for one reaches both.

## Checked, not assumed

That an empty or missing folder is harmless was tested against Caddy v2.11.4,
the version the server runs, on 24 September: the configuration is valid with
the folder missing, with it empty, and with a site in it. A deployment that adds
nothing runs exactly as it did before this folder existed.

## Changing a site here

Validate before reloading, because the proxy is shared with live:

```
docker compose -f docker-compose.production.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.production.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

A reload with a broken configuration is refused and the running one is kept, so
live stays up either way. Restarting the container instead would not be so
forgiving.
