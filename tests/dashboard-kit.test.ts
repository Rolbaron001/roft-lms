/**
 * One dashboard for a person with several roles (job sheet D25).
 */
import { describe, expect, it } from "vitest";
import { combineDashboards, type RoleDashboard } from "@/lib/dashboard-kit";

const part = (role: string, tiles: [string, "danger" | "warning" | "plain"][], sections: string[], heading?: string): RoleDashboard => ({
  role,
  heading: heading ? { title: heading, intro: "" } : undefined,
  tiles: tiles.map(([key, tone]) => ({ key, tone, count: 1, label: key, detail: "", open: "Open it", href: `/${key}` })),
  main: sections.map((id) => ({ id, title: id, empty: "", rows: [{ primary: id, href: `/${id}` }] })),
  side: [],
});

describe("combining dashboards", () => {
  it("puts every role's tiles in one row, most urgent first, each once", () => {
    const combined = combineDashboards([
      part("instructor", [["registers", "plain"], ["shared", "warning"]], ["week"]),
      part("assessor", [["referred", "danger"], ["shared", "warning"]], ["to-assess"]),
    ]);
    expect(combined.tiles.map((tile) => tile.key)).toEqual(["referred", "shared", "registers"]);
    expect(combined.main.map((section) => section.id)).toEqual(["week", "to-assess"]);
  });

  it("shows a section two roles both produce once", () => {
    const combined = combineDashboards([part("a", [], ["sittings"]), part("b", [], ["sittings", "packs"])]);
    expect(combined.main.map((section) => section.id)).toEqual(["sittings", "packs"]);
  });

  it("keeps a role's own heading only while it is the only role", () => {
    expect(combineDashboards([part("external_verifier", [], [], "Open to you")]).heading?.title).toBe("Open to you");
    expect(combineDashboards([part("external_verifier", [], [], "Open to you"), part("moderator", [], [])]).heading).toBeUndefined();
  });
});
