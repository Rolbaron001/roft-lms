/**
 * Which folders were sent to a model, and which never left the platform.
 *
 * The import history was headed "What the AI has read", and that was not true
 * of all of it. A folder carrying its own blueprint.json is read by this
 * platform alone, and a folder of material never involves a model at any
 * point - filing a document by its name is a rule rather than a judgement.
 * Looking at the real history on a local tenant, two of the three imports on
 * it had never touched a model.
 *
 * The distinction is not pedantry. A provider has to be able to say which of
 * their documents were sent to a third party and which never left the
 * platform, and under POPIA that is a question they can be asked. A page that
 * calls all of it AI leaves them unable to answer, and leaves somebody who
 * avoided the AI route on purpose believing they did not.
 *
 * Read from the proposal the reader wrote, so each row says what happened
 * rather than what usually happens.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(process.cwd(), "app/imports/page.tsx"), "utf8");

describe("the import history", () => {
  it("does not claim a model read everything on it", () => {
    // The heading itself, not the whole file: the comment explaining this
    // change quotes the old wording, and a test that cannot tell a heading
    // from a note about one teaches people to delete the note.
    const heading = /<h1[^>]*>([^<]+)<\/h1>/.exec(page)?.[1];

    expect(heading).toBe("Folders that have been read");
  });

  it("says, per folder, whether a model was involved", () => {
    expect(page).toContain("read by an AI extension");
    expect(page).toContain("read by the platform, no AI involved");
  });

  it("decides it from what was recorded, not from the kind of job", () => {
    // The proposal carries the source the reader actually took. Inferring it
    // from the target or the mode would be right most of the time, which is
    // the worst kind of wrong for a question about where documents went.
    expect(page).toMatch(/job\.proposal as \{ source\?: string \} \| null/);
    expect(page).toMatch(/source === "documents"/);
  });
});
