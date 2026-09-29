/**
 * A strip across the top of every page that says which site this is.
 *
 * Decided on 23 September: a development site alongside live, on the same
 * server, holding a straight copy of live's data. The two look identical by
 * design, because development exists to show what live will become. That is
 * exactly what makes them easy to mistake for each other: somebody enrols a
 * real learner on the test site, or a tester types nonsense into live.
 *
 * So the development site says so on every page, including the sign-in page,
 * where the mistake would start. Live sets nothing and shows nothing.
 *
 * Read from the environment at request time. Every page that renders this is
 * already dynamic, so the value is the running container's, never a value
 * baked in when the image was built. That matters because development and
 * live run the very same image.
 */
export function deploymentLabel(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const label = env.DEPLOYMENT_LABEL?.trim();
  return label ? label : null;
}

export async function DeploymentBanner() {
  const label = deploymentLabel();
  if (!label) return null;
  // Loaded here rather than at the top, so importing deploymentLabel alone
  // (the tests do) does not bring the request and database layer with it.
  const { pageT } = await import("@/lib/request");
  const t = await pageT();

  return (
    <div
      role="note"
      className="bg-[#2b333d] px-4 py-1.5 text-center text-xs font-medium text-white"
    >
      {t("banner.site", { label })}
    </div>
  );
}
