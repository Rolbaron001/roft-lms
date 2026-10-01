"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "./i18n";
import { TIMEINTERVAL, evaluateCompletion, evaluateSuccess } from "@/lib/scorm-2004";

/**
 * Plays a lesson's SCORM 1.2 or SCORM 2004 package (job sheet D8). The 1.2
 * connection is below; the 2004 one is `installScorm2004Api`, further down.
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
  version?: "1.2" | "2004";
  initial2004?: {
    completionStatus: string;
    successStatus: string;
    scoreScaled: string;
    scoreMin: string;
    scoreMax: string;
    progressMeasure: string;
    scaledPassingScore: string;
    completionThreshold: string;
    entry: string;
    totalTime: string;
  };
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

/*
 * SCORM 2004: the error conditions of the ADL's 3rd Edition Run-Time
 * Environment, 3.1.7, with their names as the specification gives them.
 */
const ERRORS_2004: Record<string, string> = {
  "0": "No Error",
  "101": "General Exception",
  "102": "General Initialization Failure",
  "103": "Already Initialized",
  "104": "Content Instance Terminated",
  "111": "General Termination Failure",
  "112": "Termination Before Initialization",
  "113": "Termination After Termination",
  "122": "Retrieve Data Before Initialization",
  "123": "Retrieve Data After Termination",
  "132": "Store Data Before Initialization",
  "133": "Store Data After Termination",
  "142": "Commit Before Initialization",
  "143": "Commit After Termination",
  "201": "General Argument Error",
  "301": "General Get Failure",
  "351": "General Set Failure",
  "391": "General Commit Failure",
  "401": "Undefined Data Model Element",
  "402": "Unimplemented Data Model Element",
  "403": "Data Model Element Value Not Initialized",
  "404": "Data Model Element Is Read Only",
  "405": "Data Model Element Is Write Only",
  "406": "Data Model Element Type Mismatch",
  "407": "Data Model Element Value Out Of Range",
  "408": "Data Model Dependency Not Established",
};

const REAL = /^-?\d+(\.\d+)?$/;
const EXITS_2004 = ["timeout", "suspend", "logout", "normal", ""];
const NAV_REQUESTS = /^(continue|previous|exit|exitAll|abandon|abandonAll|suspendAll|_none_|\{target=[^}]+\}choice)$/;

/**
 * Puts the SCORM 2004 connection (`API_1484_11`) on this window for one
 * package, and returns what takes it away again.
 *
 * Checked against the ADL's SCORM 2004 3rd Edition Run-Time Environment,
 * not recalled: the eight calls and the order they may come in, each data
 * model element's access (read only, write only, read and write), the error
 * conditions, and the evaluation of completion and success against the
 * manifest's threshold and pass mark (lib/scorm-2004.ts, which the platform
 * applies again when it records them).
 *
 * Sequencing, the part of SCORM 2004 that moves a learner between several
 * parts of one package, is not provided: the first part is played, as with
 * SCORM 1.2. A navigation request is accepted, and the package told that no
 * other part is available. Objectives, interactions and comments are accepted
 * and not kept, as for 1.2.
 */
export function installScorm2004Api(
  launch: Launch,
  lessonId: string,
  enrolmentId: string | null,
  onCompleted: () => void,
  host: { API_1484_11?: Api } = window as unknown as { API_1484_11?: Api },
): () => void {
  const start = launch.initial2004!;
  const number = (value: string) => (value === "" ? null : Number(value));
  const data = {
    learnerId: launch.initial.studentId,
    learnerName: launch.initial.studentName,
    credit: launch.initial.credit,
    location: launch.initial.lessonLocation,
    suspendData: launch.initial.suspendData,
    launchData: launch.initial.launchData,
    scoreRaw: launch.initial.scoreRaw,
    ...start,
  };
  const written: Record<string, string> = {};
  let state: "new" | "running" | "terminated" = "new";
  let lastError = "0";

  const send = (finished: boolean) => {
    if (!launch.records || !enrolmentId) return;
    fetch(`/api/scorm/${lessonId}/runtime`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrolmentId, report: { ...written, finished } }),
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
  /** A value the package may read but has not been given: 403, as 4.2 asks. */
  const set = (value: string) => (value === "" ? fail("403", "") : ok(value));

  const read: Record<string, () => string> = {
    "cmi._version": () => ok("1.0"),
    "cmi.learner_id": () => ok(data.learnerId),
    "cmi.learner_name": () => ok(data.learnerName),
    "cmi.credit": () => ok(data.credit),
    "cmi.mode": () => ok(launch.records ? "normal" : "browse"),
    "cmi.entry": () => ok(data.entry),
    "cmi.location": () => ok(data.location),
    "cmi.suspend_data": () => ok(data.suspendData),
    "cmi.launch_data": () => set(data.launchData),
    "cmi.total_time": () => ok(data.totalTime),
    "cmi.completion_status": () =>
      ok(evaluateCompletion(data.completionStatus, number(data.progressMeasure), number(data.completionThreshold))),
    "cmi.success_status": () =>
      ok(evaluateSuccess(data.successStatus, number(data.scoreScaled), number(data.scaledPassingScore))),
    "cmi.completion_threshold": () => set(data.completionThreshold),
    "cmi.scaled_passing_score": () => set(data.scaledPassingScore),
    "cmi.progress_measure": () => set(data.progressMeasure),
    "cmi.score._children": () => ok("scaled,raw,min,max"),
    "cmi.score.scaled": () => set(data.scoreScaled),
    "cmi.score.raw": () => set(data.scoreRaw),
    "cmi.score.min": () => set(data.scoreMin),
    "cmi.score.max": () => set(data.scoreMax),
    "cmi.max_time_allowed": () => set(""),
    "cmi.time_limit_action": () => ok("continue,no message"),
    "cmi.objectives._count": () => ok("0"),
    "cmi.interactions._count": () => ok("0"),
    "cmi.comments_from_learner._count": () => ok("0"),
    "cmi.comments_from_lms._count": () => ok("0"),
    "adl.nav.request": () => ok("_none_"),
  };
  const WRITE_ONLY = ["cmi.exit", "cmi.session_time"];

  const api: Api = {
    Initialize: (param = "") => {
      if (param !== "") return fail("201");
      if (state === "running") return fail("103");
      if (state === "terminated") return fail("104");
      state = "running";
      return ok();
    },
    Terminate: (param = "") => {
      if (param !== "") return fail("201");
      if (state === "new") return fail("112");
      if (state === "terminated") return fail("113");
      state = "terminated";
      send(true);
      return ok();
    },
    Commit: (param = "") => {
      if (param !== "") return fail("201");
      if (state === "new") return fail("142");
      if (state === "terminated") return fail("143");
      send(false);
      return ok();
    },
    GetValue: (element = "") => {
      if (state === "new") return fail("122", "");
      if (state === "terminated") return fail("123", "");
      if (element === "") return fail("301", "");
      if (WRITE_ONLY.includes(element)) return fail("405", "");
      const getter = read[element];
      if (getter) return getter();
      // Whether a later part of the package can be reached: there is none.
      if (/^adl\.nav\.request_valid\.(continue|previous)$/.test(element)) return ok("false");
      if (/^adl\.nav\.request_valid\.choice\./.test(element)) return ok("false");
      if (/^cmi\.(objectives|interactions|comments_from_learner|comments_from_lms|learner_preference)\./.test(element)) {
        return fail("402", "");
      }
      return fail("401", "");
    },
    SetValue: (element = "", value = "") => {
      if (state === "new") return fail("132");
      if (state === "terminated") return fail("133");
      if (element === "") return fail("351");
      const v = String(value);
      const real = (key: string, min: number | null, max: number | null) => {
        if (!REAL.test(v)) return fail("406");
        const n = Number(v);
        if ((min !== null && n < min) || (max !== null && n > max)) return fail("407");
        (data as Record<string, string>)[key] = written[key] = v;
        return ok();
      };
      switch (element) {
        case "cmi.location":
          if (v.length > 1000) return fail("351");
          data.location = written.lessonLocation = v;
          return ok();
        case "cmi.suspend_data":
          if (v.length > 64_000) return fail("351");
          data.suspendData = written.suspendData = v;
          return ok();
        case "cmi.completion_status":
          if (!["completed", "incomplete", "not attempted", "unknown"].includes(v)) return fail("406");
          data.completionStatus = written.completionStatus = v;
          return ok();
        case "cmi.success_status":
          if (!["passed", "failed", "unknown"].includes(v)) return fail("406");
          data.successStatus = written.successStatus = v;
          return ok();
        case "cmi.score.scaled":
          return real("scoreScaled", -1, 1);
        case "cmi.score.raw":
          return real("scoreRaw", null, null);
        case "cmi.score.min":
          return real("scoreMin", null, null);
        case "cmi.score.max":
          return real("scoreMax", null, null);
        case "cmi.progress_measure":
          return real("progressMeasure", 0, 1);
        case "cmi.exit":
          if (!EXITS_2004.includes(v)) return fail("406");
          written.exit = v;
          return ok();
        case "cmi.session_time":
          if (!TIMEINTERVAL.test(v)) return fail("406");
          written.sessionTime = v;
          return ok();
        case "adl.nav.request":
          if (!NAV_REQUESTS.test(v)) return fail("406");
          return ok();
      }
      if (/^cmi\.(objectives|interactions|comments_from_learner)\./.test(element)) return ok();
      if (read[element] || element.endsWith("._children") || element.endsWith("._count") || element.endsWith("._version")) {
        return fail("404");
      }
      if (/^cmi\.(comments_from_lms|learner_preference)\./.test(element)) return fail("402");
      return fail("401");
    },
    GetLastError: () => lastError,
    GetErrorString: (code = "") => ERRORS_2004[String(code)] ?? "",
    GetDiagnostic: (code = "") => ERRORS_2004[String(code || lastError)] ?? "",
  };

  host.API_1484_11 = api;
  const leaving = () => {
    if (state === "running") send(false);
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", leaving);

  return () => {
    leaving();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", leaving);
    if (host.API_1484_11 === api) delete host.API_1484_11;
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
  const t = useT();
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
          setProblem(body.error ?? "cannotOpen");
          return;
        }
        // The connection first, then the frame: a package that looks for API
        // as it loads must find it there.
        const install = (body as Launch).version === "2004" ? installScorm2004Api : installScormApi;
        remove = install(body as Launch, lessonId, enrolmentId, () => onCompletedRef.current?.());
        setLaunch(body as Launch);
      })
      .catch(() => live && setProblem("failed"));
    return () => {
      live = false;
      remove?.();
    };
  }, [lessonId, enrolmentId]);

  if (problem) {
    return <p className="text-sm text-[var(--danger)]">{problem === "failed"
          ? t("scorm.failed")
          : problem === "cannotOpen"
            ? t("scormPlayer.cannotOpen")
            : problem}</p>;
  }
  if (!launch) {
    return <p className="text-sm text-[var(--muted)]">{t("scorm.opening")}</p>;
  }
  return (
    <div className="space-y-2">
      <iframe
        src={launch.launchUrl}
        title={t("scormPlayer.package")}
        className="h-[70vh] w-full rounded-md border border-[var(--border)] bg-white"
        allow="fullscreen; autoplay"
      />
      {!launch.records ? (
        <p className="text-xs text-[var(--muted)]">{t("scorm.preview")}</p>
      ) : null}
    </div>
  );
}
