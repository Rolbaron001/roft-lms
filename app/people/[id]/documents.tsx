"use client";

import { useActionState, useState } from "react";
import {
  recordDocumentAction,
  verifyDocumentAction,
  type PeopleActionState,
} from "../actions";
import {
  CERTIFIED_KINDS,
  DOCUMENT_LABEL,
  ROUTE_LABEL,
  type DocumentKind,
  type EnrolmentReadiness,
} from "@/lib/enrolment-document-shape";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

export type HeldDocument = {
  id: string;
  kind: string;
  filename: string;
  certifiedOn: string | null;
  verification: string;
  refusedReason: string | null;
};

/**
 * The documents a learner owes, and what has been done about them.
 *
 * The route is chosen here rather than fixed, because it decides the list and
 * a coordinator often knows the route before the enrolment exists. Changing it
 * re-reads the requirement rather than storing a second answer.
 */
export function EnrolmentDocuments({
  userId,
  readiness,
  held,
  canManage,
}: {
  userId: string;
  readiness: EnrolmentReadiness;
  held: HeldDocument[];
  canManage: boolean;
}) {
  const [route, setRoute] = useState(readiness.route);
  const [uploadState, uploadAction, uploading] = useActionState<
    PeopleActionState,
    FormData
  >(recordDocumentAction, {});
  const [verifyState, verifyAction] = useActionState<
    PeopleActionState,
    FormData
  >(verifyDocumentAction, {});

  const [kind, setKind] = useState<DocumentKind>("certified_id");

  return (
    <div className="space-y-5">
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Enrolment route</span>
        <select
          value={route}
          onChange={(event) => {
            setRoute(event.target.value as typeof route);
            // The route lives in the address so the server recomputes the
            // requirement, rather than the page holding a second opinion
            // about what is outstanding.
            const url = new URL(window.location.href);
            url.searchParams.set("route", event.target.value);
            window.location.href = url.toString();
          }}
          className={inputClass}
        >
          {Object.entries(ROUTE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="block text-xs text-[var(--muted)]">
          The route decides what is required. Recognition of prior learning
          asks for a portfolio rather than a qualification certificate, because
          the claim is that the learning happened outside a formal programme.
        </span>
      </label>

      <div>
        <p className="text-sm font-medium">
          {readiness.ready
            ? "Everything required has been supplied and checked."
            : `${readiness.outstanding.length} outstanding`}
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {readiness.documents.map((document) => (
            <li key={document.kind} className="flex flex-wrap gap-2">
              <span className={document.satisfied ? "" : "font-medium"}>
                {document.label}
              </span>
              <span className="text-[var(--muted)]">
                {document.satisfied
                  ? "accepted"
                  : document.verification === "missing"
                    ? "not supplied"
                    : document.expired
                      ? `certified ${document.certifiedOn}, expired`
                      : document.verification === "refused"
                        ? `refused${document.refusedReason ? `: ${document.refusedReason}` : ""}`
                        : "not yet checked"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {held.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="pb-2">Document</th>
                <th className="pb-2">File</th>
                <th className="pb-2">Certified</th>
                <th className="pb-2">Checked</th>
              </tr>
            </thead>
            <tbody>
              {held.map((document) => (
                <tr key={document.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3">
                    {DOCUMENT_LABEL[document.kind as DocumentKind] ??
                      document.kind}
                  </td>
                  <td className="py-2 pr-3 text-[var(--muted)]">
                    {document.filename}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {document.certifiedOn ?? "—"}
                  </td>
                  <td className="py-2">
                    {canManage && document.verification === "pending" ? (
                      <form action={verifyAction} className="flex flex-wrap gap-2">
                        <input type="hidden" name="userId" value={userId} />
                        <input
                          type="hidden"
                          name="documentId"
                          value={document.id}
                        />
                        <input
                          name="reason"
                          placeholder="Reason, if refusing"
                          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                        />
                        <button
                          type="submit"
                          name="outcome"
                          value="accepted"
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                        >
                          Accept
                        </button>
                        <button
                          type="submit"
                          name="outcome"
                          value="refused"
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                        >
                          Refuse
                        </button>
                      </form>
                    ) : (
                      <span className="text-[var(--muted)]">
                        {document.verification}
                        {document.refusedReason
                          ? `: ${document.refusedReason}`
                          : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {verifyState.error ? (
        <p className="text-sm text-[var(--danger,#b00020)]">
          {verifyState.error}
        </p>
      ) : null}

      {canManage ? (
        <form
          action={uploadAction}
          className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3"
        >
          <input type="hidden" name="userId" value={userId} />

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Document</span>
            <select
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as DocumentKind)}
              className={inputClass}
            >
              {Object.entries(DOCUMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Certified on{" "}
              {CERTIFIED_KINDS.includes(kind) ? null : (
                <span className="font-normal text-[var(--muted)]">
                  (not needed)
                </span>
              )}
            </span>
            <input
              name="certifiedOn"
              type="date"
              disabled={!CERTIFIED_KINDS.includes(kind)}
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">File</span>
            <input name="file" type="file" required className={inputClass} />
          </label>

          <div className="sm:col-span-3">
            {uploadState.error ? (
              <p className="mb-2 text-sm text-[var(--danger,#b00020)]">
                {uploadState.error}
              </p>
            ) : null}
            {uploadState.done ? (
              <p className="mb-2 text-sm text-[var(--muted)]">
                {uploadState.done}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={uploading}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {uploading ? "Filing…" : "File the document"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
