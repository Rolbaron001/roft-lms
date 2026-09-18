# Job sheet — making a qualification upload actually work

**Raised 16 September 2026, after the qualification test with Heidi failed.**
Roland's four issues, broken into batches, with his answers to the four
questions I asked before he left at 13:45. Heidi's own notes to follow and will
be added here.

---

## What actually went wrong, before the batches

Two facts explain most of it, and neither was visible on the screen.

**The folder route needs an AI extension, and on the server there is no way to
have one.** The only provider the platform has is Claude Code, which works by
calling the Claude Code CLI on the machine the application runs on. On the
deployed server the application runs in a container with no CLI, so the
provider reports itself unavailable — always. Heidi could not have succeeded at
the folder import on production no matter what she did. The screen said the
extension was needed; it did not say it could never be satisfied there.

**A route that needs no AI at all already exists and works.** Uploading the
qualification document and the curriculum document individually parses the
whole curriculum with no model involved at any point — that is the path
rehearsed this morning, which read 22 modules, 85 topics, 592 elements and 182
internal assessment criteria out of the Commercial Cleaner document. It was
sitting further down the same screen, presented as the lesser option.

So the headline is not "the AI failed". It is that the platform pointed the
person at the one route that could not work and buried the one that does.

## Roland's answers, 16 September

1. **AI providers: per-person API key, Gemini first.** A ChatGPT Plus or Gemini
   Advanced *subscription* does not grant API access — those are separate
   products with separate billing. Only Claude is subscription-backed, and only
   because it shells out to a CLI on the user's own machine. So other providers
   mean each person pasting their own API key. Gemini first, because it has a
   genuinely free tier and Heidi can therefore test without anybody paying.
2. **Upload route: a guided assistant that does both.** One way in. It starts
   with the documents, needs no AI, and offers the folder route as a later step
   only where AI is actually available.
3. **The revoked error was Roland's own Claude credential.** So the job is not
   to chase a bug in the call — it is to make the platform say plainly what has
   happened and what to do, instead of surfacing a raw provider error.
4. **The mascot is mine to choose**, and Heidi can swap it later. It is one
   file reference.

---

## Batch A — Stop lying to the person at the top of the screen

**Smallest, highest value, and the direct answer to issue 1.** Nothing here is
clever; it is telling the truth in the right place.

- The folder picker states, before anything is chosen, that reading a folder
  without a `blueprint.json` needs an AI extension — and whether this person
  has one that can actually run *here*.
- Where the extension cannot run at all (the server, always, today), say that
  rather than inviting somebody to switch on a thing that will not help.
- Put the no-AI route in front of it rather than below it, with what it needs
  said plainly: the qualification document and the curriculum document.
- A revoked or expired credential produces a sentence a person can act on —
  "your Claude sign-in is no longer valid, sign in again with `claude login`" —
  rather than the provider's own error text. Issue 3.

## Batch B — The guided assistant

**The main build, and the answer to issue 1's second half.** One way in, which
asks for what it needs a step at a time and never leaves somebody guessing what
happens next.

- Step 1: which qualification, or a new one.
- Step 2: the qualification document. Read it, show what was found, confirm.
- Step 3: the curriculum document. Same.
- Step 4: the assessment specification, where there is one.
- Step 5: everything else — the folder of material, which needs no AI because
  filing documents by name is a rule rather than a judgement.
- The folder-of-everything route appears as an option at step 2 **only** when
  an extension is available, and says what it will do differently.
- Every step says what it just did and what is next. Nothing is written until
  the last confirmation.

## Batch C — Gemini, then OpenAI, by API key

**The answer to issue 2, and the only thing that makes folder import work on
the server at all.**

- A per-person API key, stored the way the existing extension credential is —
  against the person, never the tenant, never in a log.
- Google Gemini first. Free tier, so it can be tested without a purchase.
- OpenAI second, same shape.
- The provider interface already anticipates this: `PROVIDER_NAMES` is a list
  and the contract is "hand it a prompt, get text back", so a provider is meant
  to be a file rather than a project. This is the first time that claim gets
  tested.
- The settings screen explains, without being asked twice, that a ChatGPT or
  Gemini *subscription* is not the same thing as an API key. Everybody will
  assume it is; Roland did.

## Batch D — Show that something is happening

**Issue 4.**

- When a folder or a document is chosen, the eye is drawn to the button that
  appears. Curiosa's mascot, from
  `Branding/Curiosa Branding/Graphics/Mascot/`.
- A reading takes minutes, not seconds. A progress indicator that distinguishes
  "still working" from "hung", and says which document it is on rather than
  spinning anonymously.
- Applies to both routes, not only the folder one.

---

## Order, and why

**A, then D, then C, then B.**

A is an hour's work and removes the failure Heidi actually hit. D is small,
visible, and makes the difference between "nothing happened" and "it is
working" — which was half the confusion. C unblocks folder import on the server
for the first time. B is the largest and benefits from all three being settled
first.

If only some of it lands today, A and D are the ones that change Heidi's next
attempt.

---

## Where it got to, 16 September

**Batch A — done (cbff0fe).** The documents route is first, and the ordering is
the fix rather than a preference. The folder card states what it needs before
anything is chosen, including whether this person's extension can run here at
all. A revoked or expired token produces a sentence somebody can act on rather
than the provider's own words about an API being revoked.

**Batch D — done (cbff0fe).** The button announces itself when it becomes the
thing to press, and says nothing is saved yet. While a read is running there is
a spinner, the elapsed seconds, and a line that changes as it goes.
Deliberately not a progress bar: the work is one server call that does not
report back, so a bar would advance on a guess, and one that reaches ninety per
cent and stops is worse than none.

**The mascot is not in it, and that is a decision rather than an omission.**
Heidi's instinct was right, but a Curiosa character hardcoded into a shared
component appears on every tenant's screen, and the standing rule is that
nothing is built for Curiosa alone. Doing it properly means a per-tenant mascot
image somebody sets in Settings — a column, an upload, and a control. Worth
doing; not worth doing badly in an afternoon. **A question for Roland: is it
worth that, or is the neutral treatment enough?**

**Batch C — done (1e67f7d).** Gemini by API key, and with it the first
provider that can run on the server at all. The claim that "a second provider
is a file rather than a project" held: a file and one line. The settings screen
now says an API key is not a subscription, because everybody assumes it is.
OpenAI is the same shape and is next.

**Batch B — started, not finished (this commit).** The documents flow was
already two steps, read then confirm; what it never did was say so. It now
shows which step you are on, draws the eye to the read button, and shows
elapsed time while reading.

**Finished 17 September.** The three things left were looked at one at a time,
and only one of them turned out to be work.

**Choosing an existing qualification to add to — done, and it was a dead end
rather than a missing feature.** Importing documents for a qualification
already on the platform showed a red alert saying "open that qualification
instead" above a disabled button, with nothing to press and no way to get
there. It now says what is already here, why importing again would be worse
than useless — the curriculum would be replaced and anything tagged to a
criterion would go with it — and offers the one thing the person actually
wants, which is to open it and add what is missing. The dead button is gone
rather than disabled: a control that cannot be used only invites somebody to
press it.

**The assessment specification as its own step — not done, deliberately.** It
is already read, validated and filed, and its absence is already reported as
one of the three documents needed before material can be authored. Giving it a
screen of its own would add a click and change nothing about what happens.

**The folder of material as a final step — done by other means.** Creating a
qualification now lands on a panel that says what was read and points at the
folder of material further down the same page. That is the step; it did not
need a wizard around it.

---

## Heidi's notes, arrived 16 September

From the meeting record of the test. They confirm the diagnosis above and add
two things that were not on this sheet.

**Confirmed, and already done today:** the missing progress indicator; multiple
AI models rather than Claude only; the revoked-token error; and the folder
upload failing on a missing extension. Also worth recording: **Heidi's
extension was switched off on her account**, which is by design — it is
per-person and every sitting starts with it off — but it was not obvious to
either of them at the time. Batch A now says so on the screen.

**New, and not previously on this sheet:**

- **Read files directly from Google Drive and OneDrive.** Roland's own next
  step from the meeting. This is a feature rather than a fix and it is not
  small: an OAuth connection per person, per provider, with a consent screen
  and a token to store and refresh. It also changes the privacy story — the
  platform would be reaching into somebody's own drive — so it wants deciding
  rather than starting. **Batch E below.**
- **"11 of 30 items loaded" on the Advanced Occupational Certificate.** The
  meeting record is ambiguous about what the items were, and the number is
  exactly the shape of the Commercial Cleaner fault: most of a thing arriving
  and nobody able to tell that the rest did not. **Being investigated against
  the real 121151 documents rather than guessed at.**

**Not a fault:** the document alignment error Heidi found was a document filed
against tasks rather than exit level outcomes. She removed it and uploaded the
right one. The platform did what it was told.

## What the real 121151 folder turned up

Roland supplied the full folder at 13:45 — the one Heidi uploaded. Running it
through the platform's own material import found two things, and the first is
the most serious thing found all day.

**Every answer guide and every summative paper would have been published to
learners.** All 81 files were recognised and every one matched its study unit,
but 66 of them were filed as "other" because the rules only knew spelled-out
words and Curiosa name theirs the way a provider does: `WB1` for workbook one,
`SA1 V1 AG` for summative assessment one, version one, answer guide. A workbook
memorandum, a summative memorandum and a summative assessment are withheld from
anybody without the permission to assess. "Other" is withheld from nobody. So
uploading that folder would have handed thirty-eight documents to the learners
they are the answer keys for, silently, at the moment of upload.

Fixed, with the memo rules deliberately ahead of the plain ones — "WB1 AG"
contains "WB1", and getting that order wrong fails in the same direction as
having no rule at all. "Other" is now nine files: the CCMA manual, the SABPP
fact sheets, and two abbreviations nobody has explained. Those are somebody
else's documents and "I do not know" is the right answer.

**Their alignment document cannot be read, and now says so properly.** It is a
Word table — `CA - 121151 - KM PM ELO Alignment.docx` — and the matrix reader
takes a spreadsheet. What Heidi would have seen was "This file is missing
xl/workbook.xml, so it is not a readable Office document": true, and useless to
somebody holding a file. It now says it is a Word document, that the matrix has
to be a spreadsheet, and what she can do with the file she has.

**A decision for Roland.** Their document is not the same thing as the
spreadsheet matrix. The spreadsheet maps each topic element to what teaches and
tests it; this Word table maps each Exit Level Outcome to its modules and study
unit. Reading it would let the platform build the study unit structure
automatically, which is worth something — but it is a second importer for a
second document shape, not a tweak to the first. **Worth doing, or is saving it
as .xlsx enough?**

## The whole journey, rehearsed end to end

The sequence Heidi will follow next, run against the real folder with nothing
created by hand:

1. Qualification from its two documents — 15 modules, 154 criteria, no AI.
2. The 81-file folder committed against it — **five study units created from
   the filenames**, 81 documents filed, 63 attached to their study unit, 20
   carrying the version they were named with.
3. One refusal, and it is the right one: the Word alignment matrix, now saying
   plainly what it is and what to upload instead.

Two things that came out of it and are fixed:

- **Their three base documents are inside the folder as well as beside it**, so
  the ordinary sequence filed each of them twice. The same bytes again are not
  a new version, and are now recognised by digest rather than by name. A
  genuine revision still supersedes; a part and its parent may still share a
  curriculum document.
- **Nothing said what had happened.** Creating a qualification landed somebody
  on a full screen with no indication of how far they had got. It now says what
  was read and what is left — and where nothing was read, it says that instead
  of congratulating itself.

## Batch E — Google Drive and OneDrive — done, 17 September

Asked for outright: "all the learning material is stored on Google Drive."
Built as an OAuth connection per person per provider, read-only, with the token
sealed and never displayed or logged. Offered on every screen that takes a
folder — a qualification, its top-up, a course, a programme — and a test reads
the screens rather than trusting they were all changed.

**Nothing appears until an application is registered with each provider.** That
means agreeing to their terms on ROFT's behalf and putting ROFT's name on a
consent screen, which is not a decision to take by proxy. See DRIVE-SETUP.md.

**Google's own documents were nearly the whole point and were nearly missed.**
The first version skipped Docs, Sheets and Slides on the reasoning that a Doc
has no bytes and exporting is a decision about format. Roland pointed out that
downloading a Drive folder as a zip already works and involves no export by the
user — which is the flaw exactly: the export happens, on Google's side, on the
way into the zip. For a provider who works in Google throughout, skipping them
would have made a folder of their material read as empty. Docs now arrive as
Word, Sheets as Excel, Slides as PowerPoint — the formats Google's own download
picks, and the ones this platform reads.

---

## 17 September, in order

**The alignment document builds the study units.** Roland raised it as almost a
fourth base document, which it is: a curriculum publishes modules and says
nothing about study units, because grouping them is the provider's own
decision. Dropping Curiosa's folder in now produces the whole spine — five
units with their real names, the outcome each serves, and the right three
modules under each — where before it produced five labels with nothing attached.
Reads a Word table or a spreadsheet, because he said "whether it is a Word or
an Excel document" and only the first was covered at first.

**Google Drive and OneDrive.** Read-only, per person, on every screen that
takes a folder. Needs an OAuth application registered with each provider before
it appears at all — see DRIVE-SETUP.md.

**Google's own documents are exported rather than skipped**, which Roland
caught. The first version skipped Docs and Sheets on the reasoning that a Doc
has no bytes and the format was an open question. Neither holds: downloading a
Drive folder as a zip already works, and it works because Google exports the
documents on the way in. For a provider who works in Google throughout, the
first version would have made a folder of their material read as empty.

**Batch B finished.** A qualification already on the platform used to show a
red alert over a dead button; it now links straight to the qualification, where
adding what is missing leaves everything already there untouched.

**"fetch failed" says something.** Found by making a fake drive connection
locally to watch the picker render — the tests could not have found it, because
they replace `fetch` and it therefore never fails the way the real one does.

**A gap I reported was withdrawn.** The LEISA acknowledgement is built and
reachable; I had looked in the wrong library. Both notes corrected in place.

**Three false alarms on a correctly imported qualification.** Found by seeding
the HRM Officer locally and opening the screen, to see whether the new study
unit structure rendered at all. It did — and above it sat "5 of 15 modules have
no criteria yet", with every work experience topic marked in red as one that
"can never be achieved".

All three were wrong in the same way. A work experience module is proved by a
logbook a coach signs and an assessor accepts, not by assessment criteria, so
having none is its finished state. The parser knows that and the importer says
so in a comment; three screens counted them anyway. Somebody importing for the
first time reads a third of their qualification being flagged as the import
having half failed — and one of the three was written by me two days ago, on
the screen built to make curriculum lines legible.

Every count involved was correct. What was wrong was which modules the count
included, which is why the suite was green and the screen was not. The warnings
still fire for a knowledge or practical module with nothing to assess against,
which is the case they exist for.

Production confirmed afterwards: the per-topic criterion index, its partial
companion, and the tenant illustration column all applied in today's deploy.

## Open, and not to be guessed at
- **Whether a per-person API key is acceptable to Curiosa at all**, or whether
  they would rather nobody held one. Gemini's free tier makes it testable; it
  does not make it policy.
- Everything still waiting on the mail relay is unaffected by any of this.

---

## 18 September

**The mascot question is answered and built.** Roland: "make provision in
Settings for graphic changes as part of Tenant branding." It is the picture a
tenant already sets under Branding, now reaching the button somebody has to
press next as well as the empty screens it was built for — supplied by the
frame rather than passed to each control, so the fourth screen that takes a
folder gets it without anybody remembering. A tenant who sets none sees the
words and the arrow, exactly as before, and no operator's character can appear
in another operator's product. The field is no longer called "Picture for empty
screens", which described half of what it does.

**The drive route had no prompt at all.** The same fault one road further
along: somebody who has walked into a folder on their Google Drive is at
exactly the point Heidi was at when she chose a folder and did not notice the
next step had appeared. Fixed with the rest.

**The file store button was hidden by our own wiring, not by Google.** Roland
put the OAuth client id and secret on the server and the Settings page still
said no file store was set up. `docker-compose.production.yml` names each
variable the container receives one at a time, and the two drive variables were
not on that list. Two more were in the same state, found while looking:
`DATABASE_POOL_MAX` did nothing, and `MAIL_PORT` defaulted to the empty string,
which `Number(x ?? 587)` keeps — so a deployment that left it unset asked for
port 0. `tests/compose-env.test.ts` now reads what the source reads from the
environment against what `.env.example` tells an operator to set.

**Per-person API keys are settled.** Roland, 18 September: acceptable to
Curiosa "as long as the provider is not forced (must be a selection, Google,
Claude, etc)". The chooser is above the credential field and the wording
follows the provider, so nobody is asked for a "token" when they need an API
key. That closes the last open question on this sheet.

**Still on hold:** which Google account owns the OAuth application, pending
Heidi on whether Curiosa has a Workspace. See DRIVE-SETUP.md.
