/**
 * Every screen can be got to.
 *
 * Roland, 15 September: "I'm still concerned that there are parts of the system
 * that users can't access." He was right. `/offline` was in no menu and had no
 * link pointing at it from anywhere, so on a tenant that had switched offline on
 * a learner had no way to reach the one page the whole feature is for.
 *
 * Being reachable by URL is not being reachable. This test walks the app
 * directory and asks of every screen: is it in the menu, or does some other
 * screen link to it? A page that is neither is a page nobody will find.
 *
 * It is deliberately a test rather than a review note. A review finds it once;
 * a test finds it every time somebody adds a screen and forgets the menu.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/navigation";

/** Every route that has a page, ignoring dynamic segments and the API. */
function routes(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("(") || entry === "api") continue;
      found.push(...routes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      found.push(prefix || "/");
    }
  }
  return found;
}

/** Every source file's text, so links can be looked for across all of them. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sources(full));
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      out.push(readFileSync(full, "utf8"));
    }
  }
  return out;
}

/**
 * Reached without a menu and without a link, because a person arrives at them
 * some other way: signing in, being refused, or following a certificate's
 * printed reference.
 */
const ARRIVED_AT_DIRECTLY = [
  "/login",
  "/not-permitted",
  "/unknown-tenant",
  // Checked by an employer typing a reference from a printed certificate.
  "/verify",
  // Reached when the platform forces a password change.
  "/account/password",
];

describe("every screen can be got to", () => {
  const all = routes("app").filter((route) => !route.includes("["));
  const inMenu = new Set(NAV.flatMap((s) => s.items.map((i) => i.href)));
  const text = sources("app").concat(sources("components")).join("\n");

  it("finds a decent number of screens, or this test is measuring nothing", () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it.each(
    routes("app")
      .filter((route) => !route.includes("["))
      .filter((route) => !ARRIVED_AT_DIRECTLY.includes(route)),
  )("%s is in the menu or linked from somewhere", (route) => {
    if (inMenu.has(route)) return;

    // Not in the menu, so something has to link to it. Both spellings, because
    // a link is written either as a plain string or inside a template literal.
    const linked =
      text.includes(`href="${route}"`) ||
      text.includes(`href={\`${route}`) ||
      text.includes(`href={"${route}`) ||
      text.includes(`"${route}"`);

    expect(
      linked,
      `${route} is in no menu and nothing links to it, so nobody will find it`,
    ).toBe(true);
  });

  it("has no menu entry pointing at a screen that does not exist", () => {
    const missing = [...inMenu].filter((href) => !all.includes(href));
    expect(missing).toEqual([]);
  });

  /**
   * The specific failure that prompted this. Offline is gated on a tenant
   * feature rather than a permission, and a link that appears for a tenant
   * without the feature would be worse than none.
   */
  it("gives offline a home in the menu, gated on the tenant having it", () => {
    const offline = NAV.flatMap((s) => s.items).find(
      (item) => item.href === "/offline",
    );

    expect(offline).toBeTruthy();
    expect(offline?.feature).toBe("offline");
    // And to everybody, not just staff: a learner going into the field is the
    // person who needs it most and holds the fewest rights.
    expect(offline?.permission).toBe("report:own");
  });

  it("puts the templates where somebody would look for them", () => {
    const management = NAV.find((section) => section.label === "Management");

    expect(management).toBeTruthy();
    expect(management?.items.map((i) => i.href)).toContain("/templates");
  });
});
