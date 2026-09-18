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

  return (
    <Image
      src={url}
      alt=""
      aria-hidden
      width={Math.round(height * 0.7)}
      height={height}
      className={`w-auto shrink-0 motion-safe:animate-bounce ${className}`}
      style={{ height }}
      // Beside a button somebody is about to press, so it must not arrive
      // after they have pressed it.
      priority={false}
    />
  );
}
