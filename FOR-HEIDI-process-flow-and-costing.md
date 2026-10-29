# Process flow, value chain and unit costs

**For:** Heidi Edwards, Curiosa Academy  
**From:** Roland Jones, ROFT Strategic Workforce Advisory  
**Date:** 22 September 2026  
**For the meeting of:** Wednesday 23 September 2026, 10:00

---

## What this is, and what it is not

Heidi's requirement is that cost is traceable through the chain rather than
estimated at the end. This document sets out the chain, names the cost driver
at each step, and keeps three kinds of number strictly apart:

| Label | Meaning |
|---|---|
| **Measured** | Taken off the running platform or out of the QCTO document. A date is given. |
| **Quoted** | Waiting on a supplier. Named, not guessed. |
| **To supply** | Curiosa's own figure |

Nothing here is an estimate presented as a measurement. Five figures are still
outstanding and they are listed in section 6. The structure of the model holds
without them. The totals do not, so no total is given.

---

## 1. The process flow

Seven stages, from a provider being accredited to a learner's record being
disposed of. The right-hand column is what the cost attaches to, which is the
part that makes the chain traceable.

| # | Stage | What the platform does | Cost lands |
|---|---|---|---|
| A | Provider setup | Creates the tenant, its branding, its roles, its filing rules | Once per provider |
| B | Programme onboarding | Reads the curriculum, the study units and the material from the provider's folder | Once per qualification |
| C | Cohort setup | Enrols learners, assigns facilitators, assessors and moderators | Once per cohort |
| D | Delivery | Serves the material, tracks progress, holds workbooks | Per learner, per programme |
| E | Internal assessment and moderation | Holds submissions, marks, moderation decisions and appeals | Per learner, per module |
| F | External assessment and certification | EISA readiness, the sitting, the Statement of Results, the Badge | Per learner |
| G | Retention and availability | Keeps the record and its evidence available for the retention period | **Per learner, per year, after they have left** |

Stage G is the one that is easy to leave out of a price and expensive to leave
out of a price. A learner stops consuming delivery on the day they certificate
and carries on consuming storage for years afterwards. Roland raised this and
Heidi agreed it belongs in learner billing.

---

## 2. Where cost actually lands

Three buckets. Only two of them scale.

1. **Fixed.** The server, the operating system, the application images, the
   database baseline. Independent of how many tenants or learners there are.
2. **Per tenant.** Grows with the number of qualifications loaded, not with the
   number of learners.
3. **Per learner.** Grows with enrolment, and keeps running after exit for the
   whole retention period.

---

## 3. Measured figures

### The platform as it runs today

| What | Size | Measured |
|---|---|---|
| Whole stack running | about 290 MB RAM | 21 September 2026 |
| Application images, one deploy | 2.33 GB (972 MB app, 1.36 GB tools) | 21 September 2026 |
| Images retained on disk (two versions kept) | 4.66 GB | 21 September 2026 |
| Database, live, holding one qualification | 78 MB | 20 September 2026 |
| One qualification's material, live | about 1.0 GB | 121151, 19 to 20 September 2026 |
| One evidence archive, encrypted | 577 MB to 991 MB | tracks the live store |
| One database dump, encrypted | under 1.5 MB | 58 dumps totalled 0.04 GB |
| Disk fitted | 19 GB | InspireTec virtual server |
| Free after the September corrections | 6.8 GB | 21 September 2026 |

### The qualification itself

Measured by parsing the published QCTO curriculum for 121151 directly, not from
the platform's copy of it:

| | Count |
|---|---|
| Modules | 15 (5 knowledge, 5 practical, 5 workplace) |
| Topics | 51 |
| Things taught (elements) | 503 |
| Internal assessment criteria | 154 |
| Credits | 134 (50 knowledge, 48 practical, 36 workplace) |

Worth being clear about what this costs: **almost nothing**. The whole structure
above is text in a database, a few hundred kilobytes. The 1.0 GB is the guides,
workbooks and assessment documents that hang off it. Curriculum complexity
drives staff cost, not storage cost.

---

## 4. The one relationship that makes the chain traceable

Backups are taken of the whole system rather than per tenant, and the current
policy keeps three evidence archives plus thirty days of database dumps. So
every gigabyte of live material occupies itself plus its copies:

> **Disk used = operating system + 4.66 GB of images + (live store x 2.8 to 4.0)**

The range is the compression: an encrypted archive of the 1.0 GB live store
measured between 577 MB and 991 MB, so a copy costs between 0.6 and 1.0 times
what it copies.

This is the sentence to carry into any price:

> **One gigabyte of learner material costs between 2.8 and 4 gigabytes of
> disk.** It is not one.

Two levers follow directly, and both are decisions rather than technical
constraints:

- **Number of archive copies kept.** Three today. Two would take the multiplier
  to roughly 2.2 to 3.0. One would take it to 1.6 to 2.0. Each copy removed is
  recovery history given up.
- **Where the archives live.** Moving them to a separate volume takes them off
  the application's disk entirely and decouples the two. This is one of the
  questions already with Linda.

---

## 5. The unit cost model

```
Annual cost  =  Fixed
              + (qualifications loaded   x  per-qualification storage)
              + (learners enrolled       x  per-learner storage)
              + (learners in retention   x  per-learner storage)
              + (learners enrolled       x  staff hours per learner x rate)
```

**Storage per qualification: 1.0 GB live, measured.** At the multiplier above,
2.8 to 4.0 GB of disk each.

**Storage per learner: not yet measurable.** No cohort has yet run far enough to
produce a full Portfolio of Evidence, so ROFT does not have this figure and will
not invent one. It is the single most important input to learner billing.

Two things can be said about it now. The platform caps a single uploaded file at
25 MB and a single folder upload at 250 MB, so a Portfolio has a technical
ceiling well above anything likely. It will also be measurable directly, per
learner, as soon as the first cohort submits, because evidence is already stored
under a key that can simply be measured.

Until then, the sensitivity looks like this. **These are illustrations of the
arithmetic, not estimates of the answer:**

| Evidence per learner | 50 learners | 200 learners | 500 learners |
|---|---|---|---|
| 20 MB | 1 GB live, 2.8 to 4 GB disk | 4 GB live, 11 to 16 GB disk | 10 GB live, 28 to 40 GB disk |
| 50 MB | 2.5 GB live, 7 to 10 GB disk | 10 GB live, 28 to 40 GB disk | 25 GB live, 70 to 100 GB disk |
| 100 MB | 5 GB live, 14 to 20 GB disk | 20 GB live, 56 to 80 GB disk | 50 GB live, 140 to 200 GB disk |

The 19 GB currently fitted is exhausted somewhere in the middle of that table.
That is the sizing conversation already open with Linda, and this table is the
reason for it.

---

## 6. The five figures still needed

Three are supplier figures, two are Curiosa's.

| # | Figure | From | Why it matters |
|---|---|---|---|
| 1 | Monthly cost of the virtual server as fitted | Linda/Heidi, from the invoice | The fixed base of every price |
| 2 | Cost of disk beyond 19 GB, per GB per month | Linda, InspireTec | Turns every gigabyte above into rand |
| 3 | Whether backups can go on a separate attached volume | Linda, InspireTec | Changes the 2.8 to 4.0 multiplier |
| 4 | **Curiosa's own retention period** | Heidi, from the QMS policy | Multiplies per-learner storage by the number of years |
| 5 | Staff hours per learner for assessment and moderation | Heidi | Almost certainly the largest cost in the chain |

### A note on item 4

The platform does not assert a legislated retention period, and this document
does not either. Retention is a per-tenant setting, counted from the date of
certification, and it ships with a default of five years purely so that a new
tenant has a working value. Curiosa's figure should come from Curiosa's own
quality management policy and from whatever the QCTO and the OQSF actually
require, which is Heidi's ground rather than ROFT's.

The number matters more than it looks. Per-learner storage is charged for the
whole period, so the difference between three years and ten years is the
difference between one unit of retained storage and three.

---

## 7. The conclusion worth arguing about on Wednesday

On the measurements available, the infrastructure is cheap and the people are
not.

A 19 GB server holds an entire qualification, its material, its database and
three full backups, at the cost of a small virtual server. Against that, stage E
of the flow, internal assessment and moderation, consumes qualified human time
per learner per module, across 15 modules and 154 criteria for this one
qualification alone.

A billing model built on storage will therefore be precise about the cheap part
of the chain and silent about the expensive part. The recommendation is that
storage is priced as a pass-through with the multiplier in section 4 made
explicit, and that the margin is built on stage E, where the cost and the value
both actually sit.

That is a proposition to test against Heidi's actuarial framing rather than a
conclusion to accept, and it is the reason item 5 matters more than items 1 to 3.
