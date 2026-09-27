import { Fragment, type ReactNode } from "react";

/**
 * A translated sentence with something live inside it, such as a link.
 *
 * The whole sentence is one phrase in the catalogue, with a marker where the
 * link goes ("{link}: the answers are together there"), so a translator sees
 * the sentence whole and can put the link wherever their language needs it.
 * Splitting it into the words before and the words after would ask for two
 * fragments that no language can translate on their own.
 *
 * No "use client": a server page and a browser component can both use it.
 */
export function Rich({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  const pieces = text.split(/(\{\w+\})/g);
  return (
    <>
      {pieces.map((piece, index) => {
        const name = /^\{(\w+)\}$/.exec(piece)?.[1];
        return <Fragment key={index}>{name && name in parts ? parts[name] : piece}</Fragment>;
      })}
    </>
  );
}
