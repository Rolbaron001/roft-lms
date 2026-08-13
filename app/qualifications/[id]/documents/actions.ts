"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  uploadProgrammeDocument,
  ProgrammeDocumentError,
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

    if (!result.matrix) {
      return { message: `${title || file.name} uploaded.` };
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
