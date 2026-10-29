# The media server for the LMS classroom

Job sheet D41. A second server, beside the one the LMS runs on. It carries the
live classes' voice, video and shared screens (LiveKit), records each voice for
the transcript (LiveKit's recorder, "egress"), and transcribes it (our own
transcriber, in `transcriber/`). Nothing of a class leaves it but text.

The design and its sizing are in `../LIVE-CLASSES-DESIGN.md` and the document
for Heidi and Linda, `Design/Live Online Classes - Design for Consideration -
Oct2026.docx`.

## What the server needs

- Docker, and a fixed public address.
- A domain name for it (for example `class.` before the provider's domain), with
  a TLS certificate, in front of port 7880 for the browsers' connections.
- Open to the internet: 443 (TCP and UDP), 7881 (TCP), 50000 to 60000 (UDP),
  and 5349 (TCP) if 443 is shared.
- Reachable from the LMS server: 7880 (instructions to LiveKit) and 8790 (the
  transcriber). The LMS server must be reachable from here, for the reports.

## Setting it up

1. Copy this folder to the media server.
2. `livekit.yaml.example` to `livekit.yaml`, and `egress.yaml.example` to
   `egress.yaml`; fill in the names in capitals.
3. A `.env` beside them, never committed:

   ```
   LIVEKIT_API_KEY=...        # a name of your choosing
   LIVEKIT_API_SECRET=...     # 32 random characters or more
   TRANSCRIBER_SECRET=...     # another 32 or more
   WHISPER_MODEL=small        # medium is more accurate and slower
   WHISPER_LANGUAGE=en
   ```

4. `docker compose -f docker-compose.media.yml --env-file .env up -d`

## On each LMS site

Add to the site's `.env`, then recreate the app (`up -d --no-build`):

```
LIVEKIT_URL=wss://class.example.org
LIVEKIT_API_URL=http://<media server>:7880
LIVEKIT_API_KEY=...            # the same pair as the media server
LIVEKIT_API_SECRET=...
LIVEKIT_ROOM_PREFIX=live       # "dev" on the development site
TRANSCRIBER_URL=http://<media server>:8790
TRANSCRIBER_SECRET=...
CLASSROOM_TICK_SECRET=...      # for the five-minute reminders
CLASSROOM_CAPACITY=3           # classes at once, every provider together
```

`CLASSROOM_CAPACITY` is the most classes the media server carries at once,
shared by every provider on the site; set it from a load test. Left out, no
limit is applied. Each provider's own allowance is set on the Platform page.
Two sites sharing one media server share its capacity, so give each a share
that adds up to no more than the server holds.

The reminders need a five-minute job on the LMS server:

```
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CLASSROOM_TICK_SECRET" https://<site>/api/classroom/tick
```

Then, in each provider's Settings → Live classes: choose "In the LMS
classroom" as the usual way, and "Transcribe classes" once their learner
agreement carries the notice.

## Known

- The transcriber holds PyAV at 18.1.0: version 19 broke faster-whisper 1.2.1
  (found on 26 October 2026).
- Whisper's model is downloaded on the first class, into the `models` volume.
- The whole chain was tried on 26 October 2026 with Docker on a laptop: two
  voices played into a class with LiveKit's command-line tool (`lk room join
  --publish voice.ogg`) were recorded, transcribed with the right speakers,
  published and deleted. Not yet proved: what the recorder does with time
  while somebody is muted. Try it with two real people before relying on the
  order of lines across speakers.
