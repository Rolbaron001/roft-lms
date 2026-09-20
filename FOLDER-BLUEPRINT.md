# A folder that describes itself

Written 20 September 2026, against `lib/folder-plan.ts` and
`lib/folder-upload.ts` rather than from description. Roland asked where the
"summary of itself" comes from, whether it has a format, and whether a
provider can write one.

**Short answers.** It is written by whatever builds the programme — and, since
20 September, the platform will also write one for a qualification it already
holds. Yes, it has an exact format, below. And yes, a provider can write one by
hand: it is ordinary JSON in a folder they control, with nothing to register
and nothing to sign.

**Why it is worth doing.** A folder carrying one of these is read *directly*:
no model, no token, no quota, in seconds, and exactly the same every time. The
review screen says so — *"nothing in it has been inferred"*. A folder without
one has its structure worked out from the documents by an AI extension, which
on 20 September read 331 of 121151's 503 curriculum lines. The blueprint is the
most accurate of the four ways in, not a convenience.

---

## The platform will write one for you

On a qualification's **Add to it** tab, at the foot: **Save its blueprint**.
It downloads the file described below, built from what the platform holds, and
it is the cheapest thing on this page.

That makes the expensive route a one-off. Read the qualification in once,
however you like — the curriculum document, an AI extension over the folder,
by hand — then download the blueprint and drop it into the folder's
`_control/`. Every import of that folder afterwards, by this tenant or a second
site or after a restore, is free, instant and exactly the same.

It is also the worked example to generate against: a real file from a real
qualification says more about the format than this document does.

**What it will not carry** is listed on the screen beside the button, per
qualification, rather than left to be discovered. Three things recur:

- **Study units**, for the reason below.
- **Element kinds.** The curriculum parser distinguishes six — a topic element,
  a required performance, applied knowledge, a work activity, contextual
  knowledge, supporting evidence. A blueprint carries one list per topic and
  the import re-derives the kind from the module's component, so applied
  knowledge under a practical module returns as a required performance. Every
  line's wording survives exactly; the label does not.
- **Criteria that sit on a module rather than under a topic.** A blueprint
  carries criteria under topics. Move them under one first if they matter.

`tests/blueprint-round-trip.test.ts` puts a curriculum out through the writer
and back in through the reader and compares it line for line, so the two halves
cannot drift apart — and neither can this document.

---

## Where it goes

```
your-qualification-folder/
  _control/
    blueprint.json      the structure
    register.csv        optional: what each document is
  Base ID Docs/…
  Study Unit 1/…
```

The lookup is **case-insensitive**, and the path may also end in
`/_control/blueprint.json` — so a folder picked from one level up still works.
The file is decoded as **UTF-8**.

A malformed or unreadable blueprint does **not** fail the import. It returns
nothing and the folder falls through to the model, because a folder without a
blueprint is the ordinary case rather than an error.

---

## `blueprint.json`

```json
{
  "meta": {
    "title": "Advanced Occupational Certificate: Human Resource Management Officer",
    "saqa_id": "121151",
    "curriculum_code": "242303-001-00-00",
    "nqf_level": 6,
    "credits_total": 134
  },
  "purpose": "What the qualification is for, as the document states it.",

  "knowledge_modules": [
    {
      "code": "KM01",
      "title": "Creating and Implementing Organisational Architecture",
      "credits": 8,
      "topics": [
        {
          "code": "KM0101",
          "title": "Fundamentals of Business and Strategic HRM",
          "elements": [
            "Definitions, purposes, and structures of different organisations."
          ],
          "criteria": [
            "Different organisational forms are explained with examples."
          ]
        }
      ]
    }
  ],

  "practical_modules": [ ... ],
  "workplace_modules": [ ... ],

  "anomalies":   ["KM01: topic percentages add up to 85, not 100."],
  "corrections": ["PM03: a second AK0105 was renumbered AK0106."]
}
```

### `meta`

Every field is optional, and a missing one becomes blank rather than an error.

| Field | Type | Becomes |
|---|---|---|
| `title` | string | The qualification's title |
| `saqa_id` | string or number | The SAQA ID |
| `curriculum_code` | string | The curriculum code |
| `nqf_level` | **number** | The NQF level |
| `credits_total` | **number** | Total credits |

`nqf_level` and `credits_total` are ignored unless they are **numbers**.
`"6"` in quotes is dropped; `6` is kept.

`purpose` sits at the top level, not inside `meta`.

### The three module lists

`knowledge_modules`, `practical_modules`, `workplace_modules`. The list a
module appears in is what sets its component — nothing inside the module says
which it is.

Each module:

| Field | Notes |
|---|---|
| `code` | Required in practice. `short` is accepted as an alias. |
| `title` | Required in practice. |
| `credits` | Number, or omitted. |
| `topics` | The groups beneath it. `skills` and `experiences` are accepted as aliases. |

**A module with no `code` or no `title` is silently dropped.** If that leaves
no modules at all, the whole blueprint is ignored and the folder falls through
to the model. So an empty result is worth checking for.

The three aliases exist because the framework names one shape three ways:
knowledge modules carry *topics*, practical modules carry *skills*, workplace
modules carry *experiences*. Use whichever reads correctly — they are read
identically.

### Topics

| Field | Notes |
|---|---|
| `code` | Optional; null where absent. |
| `title` | The heading. |
| `elements` | What must be taught. `activities` and `knowledge` are **merged in as well**, not treated as alternatives. |
| `criteria` | The internal assessment criteria. |

**Element and criterion lists may hold strings or objects.** A string is taken
whole; an object is read for a `description` field, then a `text` field.
Anything else becomes empty and is dropped, as are blanks and whitespace. So
all three of these are equivalent:

```json
"elements": ["Do the thing."]
"elements": [{ "description": "Do the thing." }]
"elements": [{ "text": "Do the thing." }]
```

### `anomalies` and `corrections`

Both optional, both lists, and both **surfaced on the review screen** as
warnings prefixed *"From the programme build:"*.

A string is used as-is. An object has its values joined with `" - "`. This is
deliberate: whatever the authoring process could not reconcile reaches the
person committing the import, rather than sitting in a file nobody opens.

Worth using generously. The QCTO's own documents contradict themselves —
121151 reuses a code in four places, and the Commercial Cleaner curriculum
gives one module four credits in its summary and twelve in its specification.
Recording that in the blueprint puts it in front of whoever commits.

---

## What a blueprint does **not** carry

Two things, and both are deliberate.

**Study units.** The blueprint returns none. A curriculum publishes modules and
says nothing about how a provider groups them into study units — that is the
provider's own decision. They come from the alignment document, or from the
filenames in the folder.

**Documents.** The blueprint describes structure, not files. Every document in
the folder is classified by its **filename**, by rules — which is also why a
folder of material needs no model at all.

---

## `register.csv` — optional, and about the documents

Where the filename rules would guess wrong, name things explicitly. A header
row is required, and the only column that must be present is `path`.

```csv
path,study_unit,title,version
Study Unit 1/CA 121151 SU1 WB1.docx,SU1,Workbook 1,V1
Base ID Docs/121151 Curriculum Document.pdf,ALL,Curriculum document,
```

| Column | Meaning |
|---|---|
| `path` | The file's path inside the folder. Backslashes are converted to forward slashes. |
| `study_unit` | The unit's code. **`ALL`** (any case) means it applies across the qualification rather than to one unit. |
| `title` | What to call it. |
| `version` | Optional; blank becomes none. |

Headers are matched case-insensitively and may appear in any order. Quoted
cells are supported, with `""` for a quote inside one. Rows with an empty
`path` are skipped. Without a `path` column the file is ignored entirely.

---

## Worth knowing before generating these

**This is the accurate route, and it should be the default one.** If the
programme-development process can emit a `blueprint.json` beside the documents
it already produces, Curiosa never needs an AI extension for building a
qualification at all. It becomes instant, free and exactly reproducible — and
the anomalies the build already knows about travel with it.

**Check the import screen after generating your first one.** It should say
*"Read from the folder's own blueprint file"* and list your anomalies. If it
instead says the model read the documents, the blueprint was not found or not
parsed: check the path, the UTF-8 encoding, and that at least one module has
both a `code` and a `title`.
