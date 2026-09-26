"use client";

import { useActionState, useState } from "react";
import {
  AWARD_CHOICES,
  DELIVERY_CHOICES,
  deliveryAvailable,
  platformShape,
  type Award,
  type Delivery,
  type ShapeLayer,
  type Structure,
} from "@/lib/features";
import {
  updateCapabilitiesAction,
  type CapabilitiesState,
} from "./capabilities-actions";

/**
 * What this provider's platform is, and what its people call the parts.
 *
 * Roland, 21 September: "please apply it, but in such a way that it is seen to
 * be applied and can be changed. Not hard-coded for Curiosa." Then, on seeing
 * the first version as five checkboxes: "We have already determined that
 * Course and Study Unit are the same thing in terms of where they rank. What
 * the selection needs to do is to determine how the users view them."
 *
 * So two questions, each with one answer, rather than five switches that could
 * be combined into a platform nobody could navigate. The layers are not
 * optional; they are named differently by different providers, and two of them
 * are one thing seen twice.
 *
 * The shape beneath redraws as the choices change, before anything is saved.
 * That is the part that answers "it isn't clear that Programme can equal
 * Qualification": a list of choices describes the parts and never the result.
 */
export function CapabilitiesForm({
  current,
  offline,
  words,
}: {
  current: Structure;
  /** Whether working without a signal is switched on. */
  offline: boolean;
  /** This provider's own word for each layer, so the diagram reads as theirs. */
  words: { programme: string; studyUnit: string; course: string };
}) {
  const [state, act, pending] = useActionState<CapabilitiesState, FormData>(
    updateCapabilitiesAction,
    {},
  );

  const [award, setAward] = useState<Award>(current.award);
  const [delivery, setDelivery] = useState<Delivery>(current.delivery);

  /*
   * Choosing an award can make the delivery impossible: a study unit lives
   * inside a qualification, so a provider with none has nothing for one to sit
   * in. Rather than saving a shape that cannot exist and correcting it
   * silently later, the option goes unselectable and the choice moves with it.
   */
  const studyUnitsPossible = deliveryAvailable(award, "study_units");
  const effectiveDelivery: Delivery = studyUnitsPossible ? delivery : "courses";

  const shape: ShapeLayer[] = platformShape({
    award,
    delivery: effectiveDelivery,
  }).map((layer) => ({
    name:
      layer.name === "Programme"
        ? words.programme
        : layer.name === "Study unit"
          ? words.studyUnit
          : layer.name === "Course"
            ? words.course
            : layer.name,
    note: layer.note,
  }));

  return (
    <section
      id="capabilities"
      data-settings-section="What this platform is"
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        What this platform is
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        Two questions decide the shape of your platform and what its parts are
        called. Everything you do not choose goes away: its screens, its menu
        entries and its addresses.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        <strong>Nothing is deleted.</strong> Changing this hides things.
        Whatever has already been recorded stays where it is, and choosing it
        again brings the screens back with the records intact.
      </p>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      {state.saved ? (
        <p
          className="mt-3 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm"
          style={{ color: "var(--success)" }}
        >
          Saved. The menu and the wording have changed to match.
        </p>
      ) : null}

      <form action={act} className="mt-5 space-y-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            What sits at the top
          </legend>
          {AWARD_CHOICES.map((choice) => (
            <label key={choice.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="award"
                value={choice.value}
                checked={award === choice.value}
                onChange={() => setAward(choice.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{choice.label}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {choice.covers}
                </span>
                <span className="block text-xs text-[var(--muted)]">
                  <strong>Choose this when:</strong> {choice.chooseWhen}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            What a learner works through
          </legend>
          {DELIVERY_CHOICES.map((choice) => {
            const possible = deliveryAvailable(award, choice.value);

            return (
              <label
                key={choice.value}
                className={`flex items-start gap-2 text-sm ${
                  possible ? "" : "opacity-50"
                }`}
              >
                <input
                  type="radio"
                  name="delivery"
                  value={choice.value}
                  checked={effectiveDelivery === choice.value}
                  disabled={!possible}
                  onChange={() => setDelivery(choice.value)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{choice.label}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {choice.covers}
                  </span>
                  {possible ? (
                    <span className="block text-xs text-[var(--muted)]">
                      <strong>Choose this when:</strong> {choice.chooseWhen}
                    </span>
                  ) : (
                    /*
                      Said rather than merely greyed out. An option that is
                      simply dim invites somebody to click it repeatedly and
                      conclude the screen is broken.
                    */
                    <span
                      className="block text-xs"
                      style={{ color: "var(--danger)" }}
                    >
                      Not available with the choice above. A study unit sits
                      inside a qualification, and this platform has none.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Three things that stand on their own
          </legend>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="statutory_reporting"
              defaultChecked={current.statutory_reporting}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Statutory reporting</span>
              <span className="block text-xs text-[var(--muted)]">
                NLRD and Edu.Dex exports, WSP and ATR returns, and the
                statutory register behind them.
              </span>
              <span className="block text-xs text-[var(--muted)]">
                <strong>Switch it off when:</strong> you are outside South
                Africa, or somebody else files on your behalf.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="workplace_experience"
              defaultChecked={current.workplace_experience}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Workplace experience</span>
              <span className="block text-xs text-[var(--muted)]">
                Workplace agreements, coach guides, sign off sheets and the
                hours a learner logs against a host employer.
              </span>
              <span className="block text-xs text-[var(--muted)]">
                <strong>Switch it off when:</strong> nothing you deliver is
                assessed in a workplace.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="offline"
              defaultChecked={offline}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Working without a signal</span>
              <span className="block text-xs text-[var(--muted)]">
                Learners install the platform on their phone, download their
                study material before they go out, read it with no signal, and
                record their work to send back when they next have one.
              </span>
              <span className="block text-xs text-[var(--muted)]">
                <strong>Switch it on when:</strong> learners spend days away
                from a signal, such as in the field. Summatives stay online
                unless a programme is deliberately set otherwise.
              </span>
            </span>
          </label>
        </fieldset>

        {/*
          The result, not the parts, and it moves as the choices move.

          Roland: "Neither is it clear that Programme can equal Qualification
          and in Curiosa's case actually be the same thing." A list of choices
          never says what they add up to. This is derived from them, so it
          cannot drift, and it uses this provider's own words.
        */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            What that gives you
          </p>
          <ol className="mt-2 space-y-1.5">
            {shape.map((layer, index) => (
              <li key={layer.name} className="text-sm">
                <span
                  aria-hidden
                  className="mr-2 text-[var(--muted)]"
                  style={{ paddingLeft: `${index}rem` }}
                >
                  {index === 0 ? "" : "└─"}
                </span>
                <span className="font-medium">{layer.name}</span>
                {layer.note ? (
                  <span
                    className="block text-xs text-[var(--muted)]"
                    style={{ paddingLeft: `${index + 1}rem` }}
                  >
                    {layer.note}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-[var(--muted)]">
            You can rename any of these under{" "}
            <a href="#terminology" className="underline underline-offset-2">
              What you call things
            </a>
            . Only the words this shape actually uses are offered there.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Saving…" : "Save what this platform is"}
        </button>
      </form>
    </section>
  );
}
