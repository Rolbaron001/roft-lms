# Live online classes: design

Job sheet D41. Drafted 23 October 2026 from Roland's brief after his meeting
with Heidi, and his answers to the questions that followed. The meeting's notes
("Curious Callum Update", 23 October 08:04) have since been folded in; section
1 records what they added.

## 1. What was asked

Cohorts carry class schedules. The LMS must:

1. send reminders to learners through its own mail, each with the link to the
   class;
2. host the class itself, preferably without a third-party application;
3. keep an attendance register;
4. take notes and record the voice of the class;
5. log a record of the class and store it in the Library, linked to the
   cohort, where its learners can reach it.

### Why this is new, though live classes were discussed

At the meeting of 28 August Heidi described the live lectures and said "every
date and time must generate a link, a Google Meet link". The platform was built
to that: a session carries a meeting link, learners are told of it, and the
register is filled in afterwards, if need be from Meet's attendance export.
Hosting the class inside the LMS was not asked for until now.

### How Curiosa run a lecture today (meeting of 23 October)

Heidi described it:

- learners receive a calendar invitation to a Google Meet session;
- attendance is taken with Meet's attendance list;
- Gemini records the video and writes the notes.

What the notes add to this design:

1. **Calendar invitations.** Learners are used to the class arriving in their
   calendar. Each reminder therefore carries a calendar invitation (an `.ics`
   file), which every calendar application accepts. It holds the Join class
   link and is updated or cancelled when the session is.
2. **Notes during the class.** Roland is to build note taking into the LMS.
   Heidi prefers the meeting platform's own notes to a separate tool such as
   Fathom, which supports keeping notes inside the classroom. Section 3 adds a
   notes pane.
3. **Video.** Today Heidi gets a video recording from Gemini. This design
   records voice only, by Roland's decision. Heidi should know she is giving
   up the video.
4. **Timing.** Roland told Heidi it would take about a week, and the group
   agreed to wait that long. The code for all three phases can be built and
   tried locally in that time. Holding a class with real learners depends on
   the media server, which Linda has not yet been asked to quote (section 5).

### Decisions taken (Roland, 23 October 2026)

| Question | Decision |
|---|---|
| Video software | Self-hosted, open source, on our own server. No outside company carries the class. |
| Recording | None kept (Heidi, later on 23 October). Each voice is captured only to write the transcript, and deleted once the facilitator publishes the notes. |
| Cameras during the class | Allowed, off by default (Option 1), or none (Option 2): Heidi to choose. Never recorded. |
| Notes | A transcript, then an AI summary the facilitator checks once. |
| Where speech becomes text | On our own server. Voices never leave it. |
| Class size | Up to 30, with several classes running at the same time. |
| Present | Attended 75% of the class or more. The provider can change the figure. |
| Who reaches the record | The cohort's learners and its staff. Kept with the cohort's records. |
| EISA | Out of scope. Curiosa run EISA preparation (revision classes, as ordinary classes), not the sittings. |

**Everything on and from the LMS (Roland, 23 October 2026).** What happens in
Google Meet, Calendar and Gemini today is replaced by the LMS; it is not run
beside it. The outside meeting link is kept only as a contingency for a class
whose media server has failed.

**Two options put to Heidi.** The full design went to Heidi (and to Linda for
a quote) as `Design/Live Online Classes - Design for Consideration -
Oct2026.docx`, in ROFT Neutral branding. Revised the same day: no recording
of any kind is kept, only the notes, and EISA sittings are left out. The
options now differ only in the live class: **Option 1, audio and video**
(cameras: about 8 processors, 16 GB, up to 150 Mbps) and **Option 2, audio
only** (screen sharing for slides, no cameras: about 4 processors, 8 GB, up to
30 Mbps). With nothing recorded, no separate file storage is needed. The Word
document is the version for the client; where it and this note differ, it is
the later. Sections below that mention recordings, retention or file storage
are superseded by it.

**Heidi's answers to section 10 (23 October 2026), with Roland's reading:**

| Question | Answer |
|---|---|
| Option | Option 1: audio and video (cameras allowed, off by default for learners) |
| Transcript in the class record | Yes, the full transcript |
| Guests without an LMS account | No. Only the cohort's learners and its staff |
| Breakout rooms, whiteboard, polls | Yes: all three from the start (Roland) |
| A stand-in facilitator | Yes. Any staff member who may manage sessions and runs the cohort can open and run the class |
| Learners' own notes pane | No |
| Attendance | 90% overall through the life of the programme. Each class still marks present or absent by the provider's share of minutes (75% to start); the LMS tracks each learner's overall attendance against a 90% programme target and flags anyone below it (Roland) |

## 2. What already exists and is reused

| Need | Already built | What changes |
|---|---|---|
| Class schedule | Cohort sessions: date, start and end time, facilitator, study unit, module, workbooks handed out and submitted | A session gains "held in the LMS classroom" as a way of meeting, beside a venue or an outside link |
| Telling learners | A notice when a session is scheduled, cancelled or postponed | Timed reminders, sent to the LMS mailbox as well as the notices list |
| Register | Present, absent or excused per learner, with who marked it and when | Filled in automatically from the classroom; the facilitator confirms once |
| Notes | The facilitation plan's agenda, resources and "what happened" | "What happened" is pre-filled from the AI summary |
| Library | Files stored once and linked to study units | Items can also be linked to a cohort, and a class record becomes a kind of item |
| AI | The per-person AI extension | Writes the summary from the transcript, under the facilitator's own extension |

The outside link and the attendance import stay only as a contingency: if the
media server fails, that one session can be switched to an outside meeting.
They are not a second way of working.

## 3. How it works for each person

### The learner

1. When the session is scheduled, and again the day before and fifteen minutes
   before, a message arrives in the LMS mailbox: the class, the time, the
   facilitator, and a **Join class** button. The first message carries a
   calendar invitation, so the class goes into the learner's own calendar.
2. The button opens an LMS page, not an outside site. The page opens fifteen
   minutes before the start. Only learners of that cohort and its staff can
   enter.
3. On first joining they are told, once, that the class's voice is recorded and
   transcribed, and who can hear it. They cannot join without acknowledging it.
4. In the class: hear and speak, see the facilitator's camera or shared screen,
   type in the chat, raise a hand. Their own camera is off unless they switch
   it on. A **Low data** switch drops all video and keeps voice and slides.
5. After the class the record appears under the cohort in the Library: the
   recording, the summary, the transcript, and whether they were counted
   present.

### The facilitator

1. Opens the class from the session, or from the dashboard tile for today's
   classes. The class starts when the facilitator arrives; learners who come
   early wait in a lobby.
2. Has the controls a facilitator needs and no more: share screen, mute one or
   all, remove a participant, admit from the lobby, lower hands, end the class.
   A **notes** pane beside the class lets the facilitator type as they teach.
   The notes are saved as they go, are kept with the class record, and appear
   above the AI summary when the facilitator checks it.
3. When the class ends, the LMS:
   - fills in the register from who was there and for how long;
   - joins the voice recording into one file;
   - transcribes it on our server, usually within an hour;
   - drafts a summary with the facilitator's AI extension.
4. The facilitator is sent one task: check the register and the summary, then
   publish. Nothing reaches learners before that. This follows the standing
   rule: the platform does the work, a person verifies once.

### The administrator

Sets, per provider, in Settings:

- whether the classroom is switched on;
- the attendance percentage;
- how long recordings are kept;
- when reminders are sent.

## 4. How it is built

### The parts

```
Learner's / facilitator's browser
   |   LMS pages (Next.js)                 voice, camera, screen (WebRTC)
   v                                                 |
LMS server  (existing)                               v
   - issues a signed pass to enter a class   ---->  Media server  (new)
   - receives "joined / left / recording            - LiveKit: routes voice and video
     finished" from the media server                - built-in TURN: reaches learners
   - fills in the register, builds the                behind firewalls and mobile networks
     class record, sends reminders                  - Egress: records each voice track,
   - stores the recording and transcript             no browser needed
                                                    - Whisper: turns the recording into text
```

**LiveKit** (Apache 2.0 licence) is the video engine. It is free, runs on our
own server, and has what this design needs: rooms, a lobby, mute controls,
screen sharing, and recording of voice alone without running a browser. Its
**webhooks** (participant joined, participant left, recording ended) are what
make attendance and the record automatic.

**Whisper**, through the faster-whisper build, transcribes on the media server's
own processors after the class.

**Jitsi** was the other candidate. It is a complete meeting application rather
than a set of parts. It would look and behave like Jitsi inside the LMS, and its
recorder runs a browser per recording, which is heavy. LiveKit lets the
classroom be an LMS screen like every other.

### Recording each voice separately

Each participant's microphone is recorded as its own audio file. This uses
LiveKit's track recording, which needs no browser. The files are joined into
one recording for listening. Kept apart, they also let the transcript say who
spoke ("Facilitator", or the learner's name) without guessing from the sound.

### What the LMS stores

| New | Holds |
|---|---|
| A session's way of meeting | `lms_classroom` added beside venue and outside link |
| Class attendance | Each join and leave, with times, per person. The register is worked out from these. |
| Class record | Start, end, recording file, transcript, the facilitator's notes, summary, the chat, published or not, who published it |
| Library link to a cohort | So an item, a class record among them, can belong to a cohort and not only to a study unit |
| Provider settings | Classroom on or off, attendance percentage, retention period, reminder times |

Every new table carries the provider (organisation) and falls under the same
row-level isolation as the rest. A pass to enter a class names the provider, the
session and the person, and the media server is told nothing else. The tenant
isolation tests are extended to cover the classroom.

### Reminders

These are raised through the existing notification system, with a duplicate
guard so a learner gets one of each:

- when the session is scheduled;
- the day before;
- fifteen minutes before.

Each is also written to the learner's LMS mailbox. A change of time or a
cancellation is sent straight away.

The first message carries a calendar invitation (`.ics`) with a fixed
identifier for the session. A change of time sends the same identifier with a
higher sequence number, and a cancellation sends it as cancelled, so the
learner's calendar moves or removes the class rather than adding a second one.

### Attendance

- The register is filled in from the join and leave times, adding up time in
  the class across dropped connections.
- At 75% or more of the scheduled length the learner is **present**. Under
  that, **absent**, with the minutes shown, so the facilitator can mark them
  **excused** where the provider accepts the reason.
- The facilitator confirms the register once. It is then the same register
  every report and the QCTO pack already read.

## 5. What it needs from the server

This is the part with a cost, and it goes to Linda.

**The current server cannot carry it.** It has one processor, under 1 GB of
memory, and about 5 GB of disk free. Video routing and transcription would
take it down, and live with it. The classroom needs **a second server**, the
media server, for three reasons:

| Need | Why |
|---|---|
| Processors | Routing several classes at once, then transcribing each one afterwards |
| Bandwidth | The server sends each learner their own copy of what they watch |
| Network ports | Ports 7881 (TCP), 50000 to 60000 (UDP), and 443 or 5349 for TURN, opened at InspireTec |

### Rough sizing, to be confirmed with Linda and by a load test

| | Estimate |
|---|---|
| Media server | 4 processors, 8 GB memory, a fixed public address |
| Outbound bandwidth, one class of 30 with the facilitator's camera on | About 45 Mbps at most; far less with cameras off or in Low data |
| Three classes at once, cameras on | About 135 Mbps at most |
| Voice recording | About 30 MB per hour |
| Storage per cohort (about 35 lectures of 2 hours) | About 2 GB of recordings |
| Transcription | Roughly 4 to 8 times faster than the class with the "small" model on 4 to 8 processors; slower with a more accurate model |

The transcription speeds come from the faster-whisper project's own published
measurements on 8 threads. They will be measured on the real server before
they are relied on.

**Storage.** Recordings should go to the separate file storage the platform
already supports (S3-compatible), not to the main server's disk, which is
already the limit on releases.

**The development site** can use the same media server under its own keys, so
classes can be tried there before live.

## 6. POPIA and the provider's obligations

- Every participant is told on joining that the voice is recorded and
  transcribed, and who can hear it; the acknowledgement is kept.
- Nothing visual is recorded.
- Recordings and transcripts never leave our servers. The summary is written by
  the facilitator's own AI extension, which sends the transcript text, not the
  recording, to the provider the facilitator chose. This will be stated on
  screen. A facilitator without an extension publishes the transcript without a
  summary.
- Recordings are deleted at the end of the provider's retention period, and the
  deletion is logged.
- What the provider must have in place (a recording notice in its learner
  agreement, a retention period) goes into `MANUAL-NOTES.md` as it is built.

## 7. Risks

| Risk | How it is handled |
|---|---|
| Learners on poor or expensive mobile data | Cameras off by default, Low data mode, and the recording afterwards for anyone who could not stay |
| South African accents and mixed English and Afrikaans in the transcript | Tested on real class recordings before it is relied on; the facilitator checks the summary before publishing; a larger model if needed, at the cost of time |
| Company networks blocking calls | TURN over port 443 gets through most of them |
| Media server failure during a class | The session can be switched to an outside link and the attendance imported, as now |
| Cost of bandwidth | Measured in the load test before Roland commits to a server size |

## 8. Phases

Each phase is usable on its own and goes to the development site first.

| Phase | Delivers | Needs |
|---|---|---|
| A | The classroom: join from the LMS, lobby, voice, cameras, screen sharing, chat, hands, facilitator controls, the notes pane, Low data. Reminders with the Join class button and a calendar invitation. Attendance filled in automatically. | The media server and its ports |
| B | Voice recording, the class record, publishing to the Library under the cohort, retention | S3-compatible storage |
| C | Transcription on the media server, speaker names, the AI summary, the facilitator's one check | A load test of transcription on the real server |

Development can start on a local copy of the media server before the real one
exists. Nothing can be tried by Heidi or a class until the media server is in
place.

## 9. Still to settle

These do not block the design. Heidi's notes may answer some of them.

1. **Guests.** May a moderator, an external verifier or a guest speaker
   without an LMS account join a class?
2. **Extras.** Breakout rooms, a whiteboard and polls are left out of the first
   version. Are any of them needed from the start?
3. **The chat.** Should it be kept with the class record? It is planned to be.
4. **Retention.** The default period before recordings are deleted. The
   suggestion is the length of the qualification plus the period the provider
   must keep records for the QCTO.
5. **A stand-in.** May someone other than the scheduled facilitator start and
   run a class?
6. **Virtual EISA sittings.** Invigilated sittings held online currently use
   Meet or Teams with cameras on. Moving them into the classroom would mean
   recording video, which this design excludes. They stay as they are unless
   Heidi asks otherwise.
7. **Hosting.** Linda to quote the media server, its bandwidth and the storage.
8. **Learners' own notes.** Should learners also have a private notes pane,
   kept for them alone? Left out of the first version unless Heidi wants it.
9. **Video.** Heidi gets video from Gemini today. Confirm with her that voice
   only is acceptable before recording is built.
