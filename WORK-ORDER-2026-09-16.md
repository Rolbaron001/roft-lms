# Work order — Wednesday 16 September 2026, 11:45 to 18:00

Agreed with Roland at 11:40. He is away; I work without him and he reads this
and the notes below it when he returns. The deploy takes whatever is pushed at
**16:00**, so anything meant to reach the server today is committed before then
and anything after it waits for tomorrow.

## The order, as given

1. **Start on the Commercial Cleaner import.** Named first and worked first.
2. Continue down the queue below without waiting for input.

## Why Commercial Cleaner is first

SAQA 118709's curriculum imports thin: modules and topics land, topic content
and internal assessment criteria do not. On the last run it produced 129 notes
and zero criteria.

It matters more than its size suggests. The qualification test with Heidi is
the thing the end-of-month goal turns on, and a qualification that imports
without its assessment criteria looks like it worked — the modules are there,
the topics are there — right up until somebody opens a module and finds nothing
to assess against. That is a bad way for her to discover it.

Expected shape of the cause, from the `Cr 6` credits gap that preceded it: one
house style in the document that the reader does not recognise. Not a
reasoning problem — it is found by running the parser over the published PDF
and reading what it actually saw.

## Then, in order

3. **The `tools` container cannot resolve DNS.** Harmless today; breaks
   off-site backups the moment they exist. Small, and it unblocks item 4.
4. **A screen to change a qualification's kind or parent after creation.**
   Currently only settable at import, so a qualification imported as full and
   meant to be a part has to be deleted and redone.
5. **The topic element page is only reachable by a qualification manager.** A
   facilitator can open it by link but cannot browse to it. Small.
6. **The terminology string sweep.** Not every sentence reads through the
   renaming helper yet. Add "workplace experience sign-off" to the registry
   while doing it.
7. **Account for the container recreation at 11:08 today.** No restart loop,
   exit 0, healthy, server up nine days — most likely the hourly notification
   cron touching the stack, but unexplained is unexplained.
8. **EISA sitting dates, given that they cannot be known until December.**
   Heidi's answer makes this a design question rather than a missing field.
   From January to November the dates for the following year genuinely do not
   exist, so the platform must not report their absence as a fault; in
   December it should ask for them once, plainly, of somebody who can enter
   them. Record the 50 per cent RPL limit as confirmed while in there.
9. **Ask the feedback-questions question in Heidi's language.** Write it in
   plain terms for Roland to pass on: what the platform means by it, what it
   is doing in the meantime, and what changes if she sends theirs.

## Not touched without him

- **Off-site backups and object storage.** Needs a bucket, which costs money.
  His decision, and the standing rule is to ask first.
- **Curiosa's menu arrangement.** He said he will adjust it himself.
- **Anything needing the mail relay.** Blocked on Linda, not on work here.

## Rules for the sitting

- `npm run check` before every commit. No exceptions, including for a one-line
  change.
- Push freely; do not poll the deploy. Read the log after 16:00 rather than
  guessing whether it landed.
- Where something is missing, build it. Where it is ambiguous, do the part that
  is not ambiguous and write the question down here rather than stopping.
- Report what failed as plainly as what worked.

## Sent by Roland mid-afternoon, with Heidi's answers

**Curiosa's own SOPs — dropped from the list.** "All of their SOPs will need
to be reviewed once the LMS is running." So the two corrections I had been
holding (moderation still says a flat 25 per cent, Records Management still
describes a Drive) stop being separate items and become part of that review.
Item 9.6 stays in the queue as platform work; telling them about it does not.

**The RPL and credit transfer limit: 50 per cent is correct.** Confirmed by
Heidi. It was a defensible default with a note saying so; it is now the
answer, and the note should stop apologising for it.

**EISA sitting dates cannot be given.** Heidi: "We cannot give sitting dates
because they change every year and are only released in December of each
year." That is not a refusal to answer, it is the answer, and it changes what
the platform should do. A countdown that cannot run is not a fault to report
all year round — it is the normal state of affairs from January to November.
Added as item 8 below.

**The feedback questions: Heidi does not know what I meant.** "I do not
understand the 'feedback questions' part of the message." That is my fault for
asking in platform language rather than hers. Added as item 9: write the
question in plain terms, for Roland to pass on.

## What happened

**Commercial Cleaner import — done, pushed as 0562bf7 before midday.**

The cause was one character. A bullet typed in Word is not U+2022; it is a
Symbol-font glyph mapped into the Unicode Private Use Area, so it arrives as
U+F0B7 — and it is not whitespace, so trimming a line leaves it in place while
every pattern in the reader is anchored at the start of a line. There are 1,164
of them in that document, one in front of every element and every criterion.

Two older faults surfaced underneath it, both invisible while only 47 elements
were getting through: page footers were being glued onto descriptions in
thirty-three places, and six topics list their content without announcing it
with a heading.

    modules    22 -> 22
    topics     92 -> 85     the twelve lost were duplicates and misreads
    elements   47 -> 592
    criteria    0 -> 182
    notes     128 -> 12

The twelve remaining notes are real faults in the document and are meant to
stay: two codes used twice, one module whose topic weights come to 110 rather
than 100, and five topics listed in a module summary the document never gives
guidelines for. Reported, never tidied away.

No regression: 1,288 tests pass, including the readings of 121150, 121151,
SP220320 and the part qualifications.

**Worth Roland knowing before the test with Heidi:** 118709 now imports
properly, but the twelve notes are genuine and she will see them. They are not
the platform being unsure — they are the document disagreeing with itself, and
the right response to each is a decision rather than a fix.

**Heidi's three answers — done, 735a2d4.** The EISA screen no longer reports a
fault where there is none: before December it explains that the dates change
annually and says what their absence costs; from December, when the letter
should be out, it asks. The 50 per cent limit is recorded as confirmed rather
than guessed. And the feedback question is asked again in plain terms, in
FOR-HEIDI-learner-feedback.md, for Roland to send on.

**Changing what a qualification is — done, 360a791.** Kind and parent were
settable only at import, so a qualification imported as the wrong sort had to
be deleted and redone. Now correctable on the edit screen, except once anybody
is enrolled: enrolment is per programme ID, and changing the kind changes what
a learner has to do to finish. The refusal says what to do instead.

**The `tools` container — diagnosed, not changed.** The note said "cannot
resolve DNS" since 11 September; that is a misdiagnosis and would have sent
somebody hunting through resolv.conf. The compose file declares
`internal: true` on the internal network and `tools` joins that and no other,
so it reaches the database and nothing else, on purpose. Left alone: giving it
the edge network is one line, but that container holds the database admin
credentials, and the isolation should be reconsidered together with the bucket
decision that needs it. **A question for Roland.**

**The curriculum, opened to the people who teach it — done, e67f869.** A
facilitator, assessor or moderator could not read a curriculum at all: the
screens were gated on the permission to *manage* qualifications. They now admit
anybody who authors courses, assesses or moderates, with the building controls
hidden rather than the page. This also finishes yesterday's topic-element work,
which was reachable only from a page an administrator could open.

Worth recording how that nearly went wrong. Opening the page turned it into a
server error for exactly the people it had been opened to, because a call
underneath it asserted the manage permission unconditionally. The tests did not
catch it and would not have. A permission change that widens who reaches a page
has to be walked through as each of those people.

**The container restart at 11:08 — explained.** An unattended security upgrade
of Docker (docker-ce-cli 29.8.0 to 29.8.1, containerd 2.3.4 to 2.3.5) at
11:07:47, and the daemon restarted at 11:08:29. All three containers came back
on their own. Benign, and good news twice over: security updates are applying,
and the stack recovers unattended. The only thing worth knowing is that it
means a short outage at an unpredictable hour.

**Terminology sweep — headings done, prose left deliberately.** Four headings
converted; two left alone on purpose ("Enrolment notification" is the QCTO's
name, "Programme documents" means something other than the registry's
"programme"). The remaining 727 occurrences are inside sentences, where
substituting a word needs the grammar around it to agree. Days rather than
hours, for uneven benefit — see TASKS-FROM-MEETINGS.md. **A question for
Roland.**
