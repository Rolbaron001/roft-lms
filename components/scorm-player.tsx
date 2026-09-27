"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Plays a lesson's SCORM 1.2 package (job sheet D8).
 *
 * The package runs in the frame and looks for an object called `API` on the
 * windows above it; this page provides one. It keeps the learner's data here,
 * answers the package at once as SCORM expects, and sends what matters to the
 * platform when the package commits or finishes.
 *
 * Checked against the published SCORM 1.2 run-time reference on 27 September:
 * the eight calls, the cmi.core elements and their allowed values, and the
 * error codes below. Objectives and interactions, which SCORM 1.2 makes
 * optional, are accepted and not kept: a package that reports them carries on
 * rather than stopping on an error the learner cannot do anything about.
 */

type Launch = {
  launchUrl: string;
  records: boolean;
  initial: {
    studentId: string;
    studentName: string;
    lessonStatus: string;
    lessonLocation: string;
    suspendData: string;
    scoreRaw: string;
    entry: string;
    credit: string;
    launchData: string;
    totalTime: string;
  };
};

const ERRORS: Record<string, string> = {
  "0": "No error",
  "101": "General exception",
  "201": "Invalid argument error",
  "202": "Element cannot have children",
  "203": "Element not an array. Cannot have count.",
  "301": "Not initialized",
  "401": "Not implemented error",
  "402": "Invalid set value, element is a keyword",
  "403": "Element is read only.",
  "404": "Element is write only",
  "405": "Incorrect Data Type",
};

const SETTABLE_STATUS = ["passed", "completed", "failed", "incomplete", "browsed"];
const EXITS = ["time-out", "suspend", "logout", ""];
const DECIMAL = /^-?\d+(\.\d+)?$/;
const TIMESPAN = /^\d{2,4}:\d{2}:\d{2}(\.\d{1,2})?$/;

type Api = Record<string, (...args: string[]) => string>;

/**
 * Puts the SCORM 1.2 connection on this window for one package, and returns
 * what takes it away again.
 */
export function installScormApi(
  launch: Launch,
  lessonId: string,
  enrolmentId: string | null,
  onCompleted: () => void,
  host: { API?: Api } = window as unknown as { API?: Api },
): () => void {
  const data = { ...launch.initial };
  const written: Record<string, string> = {};
  let state: "new" | "running" | "finished" = "new";
  let lastError = "0";

  const send = (finished: boolean) => {
    if (!launch.records || !enrolmentId) return;
    fetch(`/api/scorm/${lessonId}/runtime`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrolmentId, report: { ...written, finished } }),
      // So the last report still arrives when the learner closes the page.
      keepalive: true,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((saved) => {
        if (saved?.completed) onCompleted();
      })
      .catch(() => undefined);
  };

  const ok = (value = "true") => {
    lastError = "0";
    return value;
  };
  const fail = (code: string, value = "false") => {
    lastError = code;
    return value;
  };

  const read: Record<string, () => string> = {
    "cmi._version": () => "3.4",
    "cmi.core._children": () =>
      "student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time",
    "cmi.core.student_id": () => data.studentId,
    "cmi.core.student_name": () => data.studentName,
    "cmi.core.lesson_location": () => data.lessonLocation,
    "cmi.core.credit": () => data.credit,
    "cmi.core.lesson_status": () => data.lessonStatus,
    "cmi.core.entry": () => data.entry,
    "cmi.core.score._children": () => "raw,min,max",
    "cmi.core.score.raw": () => data.scoreRaw,
    "cmi.core.score.min": () => written.scoreMin ?? "",
    "cmi.core.score.max": () => written.scoreMax ?? "",
    "cmi.core.total_time": () => data.totalTime,
    "cmi.core.lesson_mode": () => "normal",
    "cmi.suspend_data": () => data.suspendData,
    "cmi.launch_data": () => data.launchData,
    "cmi.comments": () => "",
    "cmi.comments_from_lms": () => "",
    "cmi.objectives._count": () => "0",
    "cmi.interactions._count": () => "0",
  };

  const api: Api = {
    LMSInitialize: () => {
      if (state === "running") return fail("101");
      state = "running";
      return ok();
    },
    LMSFinish: () => {
      if (state !== "running") return fail("301");
      state = "finished";
      send(true);
      return ok();
    },
    LMSCommit: () => {
      if (state !== "running") return fail("301");
      send(false);
      return ok();
    },
    LMSGetValue: (element) => {
      if (state !== "running") return fail("301", "");
      if (element === "cmi.core.exit" || element === "cmi.core.session_time") return fail("404", "");
      const getter = read[element];
      if (getter) return ok(getter());
      if (/^cmi\.(objectives|interactions)\./.test(element)) return fail("401", "");
      if (element.endsWith("._children")) return fail("202", "");
      if (element.endsWith("._count")) return fail("203", "");
      return fail("201", "");
    },
    LMSSetValue: (element, value) => {
      if (state !== "running") return fail("301");
      const v = String(value ?? "");
      switch (element) {
        case "cmi.core.lesson_location":
          if (v.length > 255) return fail("405");
          data.lessonLocation = written.lessonLocation = v;
          return ok();
        case "cmi.core.lesson_status":
          if (!SETTABLE_STATUS.includes(v)) return fail("405");
          data.lessonStatus = written.lessonStatus = v;
          return ok();
        case "cmi.core.score.raw":
        case "cmi.core.score.min":
        case "cmi.core.score.max": {
          if (v !== "" && !DECIMAL.test(v)) return fail("405");
          const key =
            element === "cmi.core.score.raw" ? "scoreRaw" : element === "cmi.core.score.min" ? "scoreMin" : "scoreMax";
          written[key] = v;
          if (key === "scoreRaw") data.scoreRaw = v;
          return ok();
        }
        case "cmi.core.exit":
          if (!EXITS.includes(v)) return fail("405");
          written.exit = v;
          return ok();
        case "cmi.core.session_time":
          if (!TIMESPAN.test(v)) return fail("405");
          written.sessionTime = v;
          return ok();
        case "cmi.suspend_data":
          if (v.length > 4096) return fail("405");
          data.suspendData = written.suspendData = v;
          return ok();
        case "cmi.comments":
          return ok();
      }
      if (/^cmi\.(objectives|interactions)\./.test(element)) return ok();
      if (element.endsWith("._children") || element.endsWith("._count")) return fail("402");
      if (read[element]) return fail("403");
      return fail("201");
    },
    LMSGetLastError: () => lastError,
    LMSGetErrorString: (code) => ERRORS[String(code)] ?? "",
    LMSGetDiagnostic: (code) => ERRORS[String(code ?? lastError)] ?? "",
  };

  host.API = api;
  // A learner closing the page without the package finishing still keeps
  // their place.
  const leaving = () => {
    if (state === "running") send(false);
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", leaving);

  return () => {
    leaving();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", leaving);
    if (host.API === api) delete host.API;
  };
}

export function ScormPlayer({
  lessonId,
  enrolmentId,
  onCompleted,
}: {
  lessonId: string;
  enrolmentId: string | null;
  /** Called once the platform has recorded the lesson as complete. */
  onCompleted?: () => void;
}) {
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => {
    let live = true;
    let remove: (() => void) | null = null;
    fetch(`/api/scorm/${lessonId}/runtime${enrolmentId ? `?enrolment=${enrolmentId}` : ""}`)
      .then(async (response) => {
        const body = await response.json();
        if (!live) return;
        if (!response.ok) {
          setProblem(body.error ?? "The package could not be opened.");
          return;
        }
        // The connection first, then the frame: a package that looks for API
        // as it loads must find it there.
        remove = installScormApi(body as Launch, lessonId, enrolmentId, () => onCompletedRef.current?.());
        setLaunch(body as Launch);
      })
      .catch(() => live && setProblem("The package could not be opened. Check your connection and try again."));
    return () => {
      live = false;
      remove?.();
    };
  }, [lessonId, enrolmentId]);

  if (problem) {
    return <p className="text-sm text-[var(--danger)]">{problem}</p>;
  }
  if (!launch) {
    return <p className="text-sm text-[var(--muted)]">Opening the package…</p>;
  }
  return (
    <div className="space-y-2">
      <iframe
        src={launch.launchUrl}
        title="Course package"
        className="h-[70vh] w-full rounded-md border border-[var(--border)] bg-white"
        allow="fullscreen; autoplay"
      />
      {!launch.records ? (
        <p className="text-xs text-[var(--muted)]">
          A preview: what the package reports is not kept, because this is not your own enrolment.
        </p>
      ) : null}
    </div>
  );
}
