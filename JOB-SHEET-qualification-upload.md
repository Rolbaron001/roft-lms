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

## Open, and not to be guessed at

- **Heidi's own notes**, when they arrive. Added here rather than remembered.
- **Whether a per-person API key is acceptable to Curiosa at all**, or whether
  they would rather nobody held one. Gemini's free tier makes it testable; it
  does not make it policy.
- Everything still waiting on the mail relay is unaffected by any of this.
