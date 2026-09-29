/**
 * The address a new client is given, as the Platform Owner's form shows it.
 *
 * The form said every client would live at name.lms.roftbusiness.org. Since 25
 * September that is the development site's address; live is
 * lms.curiosa.academy, and a client added there is reached under that. Roland,
 * 29 September: "This can't be." Each deployment knows its own address
 * (PLATFORM_HOST, set from LMS_DOMAIN), so the form shows that one and names
 * no domain of its own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the address a new client is given", () => {
  const form = read("app/platform/new-tenant-form.tsx");
  const page = read("app/platform/page.tsx");

  it("names no deployment's domain", () => {
    expect(form).not.toMatch(/roftbusiness\.org|curiosa\.academy/);
  });

  it("is built from the address of the deployment the form runs on", () => {
    expect(page).toMatch(/platformHost=\{process\.env\.PLATFORM_HOST/);
    expect(form).toMatch(/\$\{slug \|\| "name"\}\.\$\{platformHost\}/);
  });

  it("says the whole address once the client exists", () => {
    expect(form).toMatch(/\$\{state\.tenantUrl\}\.\$\{platformHost\}/);
  });
});
