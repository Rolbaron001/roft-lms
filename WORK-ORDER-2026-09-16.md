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

## What happened

Filled in as the afternoon goes. Newest last.
