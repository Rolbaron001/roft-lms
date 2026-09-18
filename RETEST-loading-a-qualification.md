# Loading a qualification — what to do on the day

For the retest after 16 September. One page, because the last attempt failed
on not knowing which of two routes to take rather than on anything being
broken.

## The short version

**Use "Build one from its documents". It needs no AI extension and it reads the
whole curriculum.** That is the route that read 22 modules, 85 topics, 592
elements and 182 assessment criteria out of the Commercial Cleaner document
with no model involved at any point.

The folder route is the one that failed on 16 September, and it failed for a
reason nobody could see: reading a folder that does not describe itself needs
an AI extension, and the only extension the platform had at the time cannot run
on the server at all. Both screens now say so before you choose.

## What you need

Two documents, and a third if you have it:

| | |
|---|---|
| **Curriculum Document** | Required. The modules, topics and internal assessment criteria. |
| **Qualification Document** | Recommended. The SAQA registration extract — the only source of the SAQA ID and the Exit Level Outcomes. |
| **Assessment Specification** | Optional. Filed and indexed so it is searchable. |

PDF or Word. Not the pre-2007 `.doc` format — the platform will say so plainly
if you hand it one.

## The steps

1. **Qualifications → Build one from its documents.**
2. Choose the documents. Nothing happens yet.
3. **Press "Read them".** The character and the arrow point at the button when
   it becomes the thing to press. This takes a few minutes for a full
   curriculum; the screen counts the seconds so you can tell it is working
   rather than stuck. Leave the page open.
4. **Check what it found** — modules, topics, criteria, Exit Level Outcomes.
   Nothing has been written to the platform yet. If it looks wrong, close the
   panel and nothing has happened.
5. **Create it.** Now it is written, and you land on the qualification.

## Then the material

From the qualification's own page, further down, upload the folder of study
material. **This never needs an AI extension** — filing a document by its name
is a rule, not a judgement.

Two things worth knowing, because both surprised us:

- **Answer guides and memoranda are recognised and withheld.** `SA1 V1 AG`,
  `WB1 AG` and the rest are filed as restricted and are not visible to
  learners. Before this was fixed, 38 of Curiosa's own files would have been
  published to the learners they are the answer keys for.
- **The alignment document is read too**, and it builds the study units — five
  units with their real names, the outcome each serves and the right modules
  under each. Word or Excel both work.

## If something goes wrong

**"Your AI extension is not switched on."** It is per person and per sitting —
it starts off every time you sign in, by design. The switch is in the header.
This only matters for the folder route; the documents route never asks.

**Anything about Claude Code not being available.** Expected on the hosted
platform: that provider works by running a program on the same machine as the
platform, and the server does not have one. It is not a fault and there is
nothing for anyone to fix. Settings now marks it in the list. Choose Google
Gemini instead — it has a free tier, so it costs nothing to try.

**A document is refused.** Read the sentence; it says what the file is and what
to do. A Word alignment matrix, a pre-2007 `.doc`, a curriculum document handed
to the qualification slot — each gets its own answer rather than a generic one.

**The same document twice.** Not a problem. The platform recognises the same
bytes by digest rather than by name, so base documents sitting both inside the
folder and beside it are filed once. A genuine revision still supersedes.

## What is not ready yet

**Reading a folder straight from Google Drive.** Built, and waiting on one
decision about which Google account the connection is registered under — see
`DRIVE-SETUP.md`. Until then, a folder comes from your own computer, which
works and needs nothing.

---

*Written 18 September 2026, from what the platform actually does — every claim
above was either run in the browser or is held by a test against the real
published documents.*
