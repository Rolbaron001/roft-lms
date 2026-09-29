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
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";
import { Rich } from "@/components/rich-text";

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
  const t = useT();
  const [state, act, pending] = useActionState<CapabilitiesState, FormData>(
    updateCapabilitiesAction,
    {},
  );

  /** A choice's wording in the reader's language, or the library's English. */
  const said = (group: "award" | "delivery", value: string, part: "label" | "covers" | "when", english: string) =>
    maybe(t, `shape.${group}.${value}.${part}`) ?? english;

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
            : layer.name === "Qualification / Programme"
              ? t("shape.layer.qualificationProgramme")
              : layer.name === "Qualification"
                ? t("shape.layer.qualification")
                : layer.name,
    note:
      layer.name === "Qualification / Programme"
        ? t("shape.note.qualificationProgramme")
        : layer.name === "Qualification"
          ? t("shape.note.qualification")
          : layer.name === "Programme"
            ? award === "programmes_only"
              ? t("shape.note.programmeOnly")
              : t("shape.note.programmeWithQualification")
            : layer.note
              ? t("shape.note.bottom")
              : undefined,
  }));

  return (
    <section
      id="capabilities"
      data-settings-section={t("settings.section.capabilities")}
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        {t("shape.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{t("shape.intro")}</p>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        <strong>{t("shape.nothingDeleted")}</strong> {t("shape.nothingDeletedNote")}
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
          {t("shape.saved")}
        </p>
      ) : null}

      <form action={act} className="mt-5 space-y-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("shape.top")}</legend>
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
                <span className="font-medium">{said("award", choice.value, "label", choice.label)}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {said("award", choice.value, "covers", choice.covers)}
                </span>
                <span className="block text-xs text-[var(--muted)]">
                  <strong>{t("shape.chooseWhen")}</strong> {said("award", choice.value, "when", choice.chooseWhen)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("shape.works")}</legend>
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
                  <span className="font-medium">{said("delivery", choice.value, "label", choice.label)}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {said("delivery", choice.value, "covers", choice.covers)}
                  </span>
                  {possible ? (
                    <span className="block text-xs text-[var(--muted)]">
                      <strong>{t("shape.chooseWhen")}</strong>{" "}
                      {said("delivery", choice.value, "when", choice.chooseWhen)}
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
                      {t("shape.unavailable")}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("shape.standalone")}</legend>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="statutory_reporting"
              defaultChecked={current.statutory_reporting}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{t("shape.statutory")}</span>
              <span className="block text-xs text-[var(--muted)]">{t("shape.statutoryCovers")}</span>
              <span className="block text-xs text-[var(--muted)]">
                <strong>{t("shape.switchOffWhen")}</strong> {t("shape.statutoryWhen")}
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
              <span className="font-medium">{t("shape.workplace")}</span>
              <span className="block text-xs text-[var(--muted)]">{t("shape.workplaceCovers")}</span>
              <span className="block text-xs text-[var(--muted)]">
                <strong>{t("shape.switchOffWhen")}</strong> {t("shape.workplaceWhen")}
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
              <span className="font-medium">{t("shape.offline")}</span>
              <span className="block text-xs text-[var(--muted)]">{t("shape.offlineCovers")}</span>
              <span className="block text-xs text-[var(--muted)]">
                <strong>{t("shape.switchOnWhen")}</strong> {t("shape.offlineWhen")}
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
            {t("shape.gives")}
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
            <Rich
              text={t("shape.rename")}
              parts={{
                link: (
                  <a href="#terminology" className="underline underline-offset-2">
                    {t("shape.renameLink")}
                  </a>
                ),
              }}
            />
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? t("common.saving") : t("shape.save")}
        </button>
      </form>
    </section>
  );
}
