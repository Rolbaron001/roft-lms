import { requirePermission } from "@/lib/request";
import { getIngestJob, IngestError } from "@/lib/folder-import";
import type { IngestionPlan } from "@/lib/folder-plan";
import { writeMatrix } from "@/lib/programme-matrix";

/**
 * The folder's programme map as a spreadsheet (D60 stage 3), filled in from
 * what was read and answered so far, to be corrected in Excel and put back in
 * the folder as "Programme map.xlsx".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePermission("qualification:manage");
  let plan: IngestionPlan | null;
  try {
    plan = (await getIngestJob(session, id)).proposal as IngestionPlan | null;
  } catch (error) {
    if (error instanceof IngestError) return new Response("Not found.", { status: 404 });
    throw error;
  }
  if (!plan) return new Response("Nothing has been read yet.", { status: 404 });
  const bytes = await writeMatrix(plan, { title: plan.qualification.title, code: plan.qualification.curriculumCode });
  return matrixResponse(bytes);
}

function matrixResponse(bytes: Uint8Array) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="Programme map.xlsx"',
      "cache-control": "private, no-store",
    },
  });
}
