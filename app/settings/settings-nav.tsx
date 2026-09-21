"use client";

import { PageNav } from "@/components/page-nav";

/**
 * What is on the settings page, and how to get to it.
 *
 * Roland, 18 September: "It is very difficult to navigate there especially if
 * you don't know all the options that can be found there."
 *
 * The difficulty was not the length of the page, it was that the page never
 * said what was on it. Nine sections stacked vertically, each only
 * discoverable by scrolling past the ones above - so somebody looking for the
 * mail test had to already know it was below terminology, and somebody who did
 * not know the platform could set a clock never found out.
 *
 * This was a screen's worth of scroll-tracking of its own until 21 September,
 * when the same complaint arrived about the qualification page - "a floating
 * navigation bar or sub-menu would work better for such long pages". Two
 * copies of the same list, one floating and one not, would have drifted the
 * first time either was touched. So the behaviour lives in components/page-nav
 * and this names the attribute the settings sections already carry.
 */
export function SettingsNav() {
  return (
    <PageNav
      attribute="data-settings-section"
      ariaLabel="Settings sections"
    />
  );
}
