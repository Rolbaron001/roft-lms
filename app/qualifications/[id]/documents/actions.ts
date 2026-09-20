"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  uploadProgrammeDocument,
  ProgrammeDocumentError,
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@/lib/programme-documents";
import { AlignmentMatrixError } from "@/lib/alignment-matrix";
import { OfficeReadError } from "@/lib/office";

export type UploadState = {
  error?: string;
  message?: string;
  /** Reported when the file was an alignment matrix and was read. */
  detail?: string[];
};

export async function uploadDocumentAction(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await requirePermission("qualification:manage");

  const qualificationId = String(formData.get("qualificationId") ?? "");
  const attachTo = String(formData.get("attachTo") ?? "");
  const kind = String(formData.get("kind") ?? "") as DocumentKind;
  const title = String(formData.get("title") ?? "").trim();
  const version = String(formData.get("version") ?? "").trim();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  // attachTo carries "qualification", "unit:<id>" or "module:<id>", so the one
  // scope the library allows is decided here rather than by three optional
  // fields that could all arrive at once.
  const scope = attachTo.startsWith("unit:")
    ? { studyUnitId: attachTo.slice(5) }
    : attachTo.startsWith("module:")
      ? { curriculumModuleId: attachTo.slice(7) }
      : { qualificationId };

  try {
    const result = await uploadProgrammeDocument(
      session,
      {
        kind,
        title: title || file.name,
        version: version || undefined,
        ...scope,
      },
      {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    );

    revalidatePath(`/qualifications/${qualificationId}`);

    /*
     * An alignment document builds the study units, and this said nothing
     * about it.
     *
     * Roland, 20 September: "The document is uploaded but nothing seems to
     * happen from it. The navigation still shows outstanding study units."
     * Two faults, and this is the second. `uploadProgrammeDocument` has
     * returned an `alignment` summary all along - five study units, their exit
     * level outcomes, the modules linked under each - and this action read
     * only `matrix`, so the one message he got back was "uploaded.".
     *
     * That is worse than an error would have been. An upload that did its
     * whole job and an upload that did nothing produced the same sentence, so
     * there was no way to tell them apart from the screen.
     */
    if (result.alignment) {
      const applied = result.alignment;
      const detail = [
        `${applied.studyUnitsCreated} study units created${applied.studyUnitsUpdated > 0 ? `, ${applied.studyUnitsUpdated} updated` : ""}.`,
        `${applied.outcomesRecorded} exit level outcomes recorded, ${applied.modulesLinked} modules placed under a study unit.`,
        ...applied.notes,
      ];

      if (result.reclassified) {
        detail.unshift(
          "Filed as a curriculum alignment matrix rather than the kind chosen — it names study units and exit level outcomes, so it is one.",
        );
      }

      // Nothing was built, and saying "uploaded" over the top of that is how
      // the last two days went.
      if (
        applied.studyUnitsCreated === 0 &&
        applied.studyUnitsUpdated === 0
      ) {
        return {
          error:
            "That document was filed, but no study units came out of it. It reads as an alignment document, so either the modules it names are not in the curriculum under those codes, or the study units are already there. The detail is in the document library entry.",
        };
      }

      return { message: "Alignment document read. Study units built.", detail };
    }

    if (!result.matrix) {
      return {
        message: `${title || file.name} uploaded.`,
        // Said plainly, because "uploaded" reads as though something happened.
        detail: [
          `Filed as ${DOCUMENT_KIND_LABELS[result.kind]}. Nothing was read out of it — only an alignment document or an alignment matrix is read.`,
        ],
      };
    }

    const matrix = result.matrix;
    const detail = [
      `Read the “${matrix.sheetName}” sheet.`,
      `Columns recognised: ${matrix.columnsRecognised.join(", ")}.`,
      `${matrix.rowsRead} rows, ${matrix.elementsMatched} curriculum lines matched, ${matrix.alignmentsRecorded} links recorded.`,
    ];

    if (matrix.unmatchedCodes.length > 0) {
      detail.push(
        `${matrix.unmatchedCodes.length} codes in the matrix are not in the curriculum yet: ${matrix.unmatchedCodes.slice(0, 12).join(", ")}${matrix.unmatchedCodes.length > 12 ? "…" : ""}. These are usually modules nobody has transcribed.`,
      );
    }

    return { message: "Alignment matrix uploaded and read.", detail };
  } catch (error) {
    if (
      error instanceof ProgrammeDocumentError ||
      error instanceof AlignmentMatrixError ||
      error instanceof OfficeReadError
    ) {
      return { error: error.message };
    }
    throw error;
  }
}
