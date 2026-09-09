import { readFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { createQualificationFromDocuments } from "./lib/qualification-from-document";
import { permissionsFor } from "./lib/rbac";

const sql = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const [org] = await sql`select id from organisations where slug='curiosa'`;
const [u] = await sql`select id from users where email='browsercheck@curiosa.test'`;
await sql.end();

const session = {
  sessionId: "00000000-0000-0000-0000-000000000000",
  userId: u.id, organisationId: org.id, email: "browsercheck@curiosa.test",
  firstName: "Browser", lastName: "Check", roles: ["tenant_admin" as const],
  permissions: permissionsFor({ roles: ["tenant_admin"] }),
  mustChangePassword: false, aiOn: false,
};
const f = (n: string) => ({ filename: n, bytes: new Uint8Array(readFileSync(`tests/fixtures/${n}`)) });

const parent = await createQualificationFromDocuments(session,
  { curriculum: f("118709-curriculum.pdf"), qualification: f("118709-qualification.pdf") },
  { title: "Occupational Certificate: Commercial Cleaner", curriculumCode: "811201-000-00", saqaId: "118709", totalCredits: 120 });
console.log("parent", parent.qualificationId, "modules", parent.summary.modules);

const part = await createQualificationFromDocuments(session,
  { curriculum: f("118709-curriculum.pdf"), qualification: f("118710-qualification.pdf") },
  { title: "Occupational Certificate: Commercial Kitchenette Cleaner", curriculumCode: "811201-000-01", saqaId: "118710", totalCredits: 47 });
console.log("part", part.qualificationId, "modules", part.summary.modules);
console.log(part.summary.warnings.join("\n"));
