"use client";

import Image from "next/image";
import { createContext, useContext } from "react";

/**
 * The tenant's own character, where one is set.
 *
 * Heidi asked for a Curiosa character beside the button somebody has to press
 * next, and she was right about the problem: an arrow and a ring are easy to
 * miss, and she missed them. What cannot follow from that is a Curiosa graphic
 * in a shared component, because the same components are what every other
 * tenant sees. So the picture is the tenant's, set in Settings under Branding,
 * and a tenant who sets none gets the words and the arrow exactly as before.
 *
 * Supplied through context rather than a prop on each control. Four screens
 * offer a folder today and the number only goes up; threading an image down
 * through every page that renders a picker means the one added next month is
 * the one that forgets. The frame knows the tenant already, so it says it once.
 *
 * Nothing here decides *whether* to draw attention. That is the control's own
 * business, and a picture that appears before there is anything to press is
 * decoration.
 */
const TenantIllustration = createContext<string | null>(null);

export function TenantIllustrationProvider({
  url,
  children,
}: {
  url: string | null;
  children: React.ReactNode;
}) {
  return (
    <TenantIllustration.Provider value={url}>
      {children}
    </TenantIllustration.Provider>
  );
}

export function useTenantIllustration(): string | null {
  return useContext(TenantIllustration);
}

/**
 * The character pointing at whatever comes next.
 *
 * Decorative throughout: `alt=""` and `aria-hidden`, because every place this
 * appears has a sentence beside it saying the same thing in words. A screen
 * reader announcing "Curiosa mascot" before "now press this to read it" would
 * be noise in front of the only part that carries meaning.
 *
 * Renders nothing at all where no illustration is set, so the caller can place
 * it unconditionally and a tenant without one sees no gap where a picture
 * would have been.
 */
export function AttentionMascot({
  className = "",
  height = 56,
}: {
  className?: string;
  height?: number;
}) {
  const url = useTenantIllustration();
  if (!url) return null;

  // `alt` is written out on each element rather than spread in with the rest.
  // It is the one attribute here that carries a decision - this picture is
  // decorative and a screen reader should skip it - and a linter cannot see an
  // attribute that arrives through a spread, so spreading it means the rule
  // that exists to catch a missing alt cannot do its job on either branch.
  const shared = {
    "aria-hidden": true as const,
    className: `w-auto shrink-0 motion-safe:animate-bounce ${className}`,
    style: { height },
  };

  /*
   * An address somewhere else is drawn without the image optimiser.
   *
   * The optimiser refuses a host that is not in next.config's remotePatterns -
   * it answers the request with 400 "url parameter is not allowed" - so a
   * tenant who pasted an https address got no picture and no explanation,
   * while the field beside the box invited exactly that. Allowing every host
   * instead would turn the optimiser into an open fetcher of arbitrary URLs on
   * the server's behalf, which is a great deal to give away for a decorative
   * graphic.
   *
   * So a remote one is a plain img. It loses resizing and format conversion on
   * an image already under a hundred pixels tall, and it makes the promise on
   * the settings field true.
   */
  if (/^https?:\/\//i.test(url)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" {...shared} />;
  }

  return (
    <Image
      src={url}
      alt=""
      {...shared}
      width={Math.round(height * 0.7)}
      height={height}
    />
  );
}
