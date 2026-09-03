import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkFolder } from "@/lib/folder-walk";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "walk-test-"));

  // A shape like the client's: everything of interest one or two levels down.
  await writeFile(join(root, "readme.txt"), "top level");

  for (const folder of ["01 Foundation", "03 Governance", "Qualification Details"]) {
    await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, folder, "doc.docx"), "x");
  }

  await mkdir(join(root, "_control", "_build_scripts"), { recursive: true });
  await writeFile(join(root, "_control", "blueprint.json"), "{}");
  await writeFile(join(root, "_control", "_build_scripts", "build.py"), "x");

  // Deeper than anything real, to prove the depth limit reports rather than
  // silently stopping.
  await mkdir(join(root, "a", "b", "c", "d", "e", "f", "g"), { recursive: true });
  await writeFile(join(root, "a", "b", "c", "d", "e", "f", "g", "deep.txt"), "x");

  // Ignored by name, because a node_modules would swamp the file limit before
  // reaching a single document.
  await mkdir(join(root, "node_modules", "junk"), { recursive: true });
  await writeFile(join(root, "node_modules", "junk", "index.js"), "x");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("walkFolder", () => {
  it("reads subfolders, not just the folder pointed at", async () => {
    const { files } = await walkFolder(root);
    const paths = files.map((file) => file.path);

    expect(paths).toContain("readme.txt");
    expect(paths).toContain("01 Foundation/doc.docx");
    expect(paths).toContain("03 Governance/doc.docx");
    expect(paths).toContain("Qualification Details/doc.docx");
  });

  /**
   * The blueprint and the manifest live under `_control`, and they are the most
   * valuable things in a programme folder. Excluding that folder by name would
   * throw away the reason the structured path exists.
   */
  it("reads the control folder, where the blueprint lives", async () => {
    const { files } = await walkFolder(root);
    expect(files.map((file) => file.path)).toContain("_control/blueprint.json");
  });

  /** Build scripts are excluded by what they are, not by where they sit. */
  it("finds build scripts but marks them as nothing to read", async () => {
    const { files } = await walkFolder(root);
    const script = files.find(
      (file) => file.path === "_control/_build_scripts/build.py",
    );
    expect(script?.kind).toBe("skip");
  });

  it("skips node_modules by name", async () => {
    const { files } = await walkFolder(root);
    expect(files.some((file) => file.path.startsWith("node_modules"))).toBe(
      false,
    );
  });

  /**
   * The one that matters. A walk that quietly stopped would import a folder
   * missing half its material and report success, and nobody would know which
   * half.
   */
  it("says so when a folder is too deep to read", async () => {
    const { files, warnings } = await walkFolder(root);

    expect(files.some((file) => file.path.endsWith("deep.txt"))).toBe(false);
    expect(warnings.some((line) => /nested more than/.test(line))).toBe(true);
  });

  it("returns no warnings for an ordinary folder", async () => {
    const shallow = await mkdtemp(join(tmpdir(), "walk-plain-"));
    try {
      await mkdir(join(shallow, "05 Theory Guides"), { recursive: true });
      await writeFile(join(shallow, "05 Theory Guides", "SU1.docx"), "x");

      const { files, warnings } = await walkFolder(shallow);
      expect(files).toHaveLength(1);
      expect(warnings).toEqual([]);
    } finally {
      await rm(shallow, { recursive: true, force: true });
    }
  });

  it("classifies by extension so a converter is only asked for where needed", async () => {
    const { files } = await walkFolder(root);
    const kinds = new Map(files.map((file) => [file.path, file.kind]));

    expect(kinds.get("readme.txt")).toBe("text");
    expect(kinds.get("01 Foundation/doc.docx")).toBe("convert");
    expect(kinds.get("_control/blueprint.json")).toBe("text");
  });
});
