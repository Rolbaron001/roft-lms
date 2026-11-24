import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { qualifications } from "@/db/schema";
import { requirePermission } from "@/lib/request";
import { filedPlan } from "@/lib/filed-map";
import { writeMatrix } from "@/lib/programme-matrix";

/**
 * A built qualification's programme map as a spreadsheet (D60 stage 3): kept
 * with the programme's folder, it makes the next upload of the same folder
 * place every file exactly as it is placed now.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePermission("qualification:manage");
  const [qualification] = await withTenant(session.organisationId, (tx) =>
    tx.select({ title: qualifications.title, code: qualifications.curriculumCode }).from(qualifications).where(eq(qualifications.id, id)),
  );
  if (!qualification) return new Response("Not found.", { status: 404 });
  const bytes = await writeMatrix(await filedPlan(session, id), { title: qualification.title, code: qualification.code });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="Programme map.xlsx"',
      "cache-control": "private, no-store",
    },
  });
}
