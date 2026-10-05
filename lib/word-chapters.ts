import mammoth from "mammoth";

/**
 * A Word document as chapters, for reading in the page (components/
 * document-viewer.tsx). Split at the document's own top headings, which in a
 * theory guide are its chapters and topics.
 *
 * The HTML is the converter's own: text is escaped and no script survives
 * it. Links are the one thing a document can carry that would act, so every
 * link that is not plain web, mail or in-page is reduced to its text.
 */
export async function wordChapters(bytes: Uint8Array): Promise<{ title: string; html: string }[]> {
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const html = result.value.replace(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attributes: string, text: string) => {
    const href = /href="([^"]*)"/i.exec(attributes)?.[1] ?? "";
    return /^(https?:|mailto:|#)/i.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
  });

  // The first heading level the document uses at least twice is its
  // chapters, and the level below it its topics: SU1's guide puts all of
  // Knowledge Module 1 under one chapter heading, far too long for one screen.
  const used = [1, 2, 3, 4].filter((n) => (html.match(new RegExp(`<h${n}[\\s>]`, "gi")) ?? []).length >= 2);
  if (used.length === 0) return [{ title: "The guide", html }];
  // Down to the third level used: the guide's topics (KM0101 …) sit there.
  const levels = used.slice(0, 3).join("");

  const parts = html.split(new RegExp(`(?=<h[${levels}][\\s>])`, "i"));
  const chapters: { title: string; html: string }[] = [];
  let carried = "";
  for (const part of parts) {
    const heading = new RegExp(`^<h([${levels}])[^>]*>([\\s\\S]*?)</h\\1>`, "i").exec(part);
    const title = heading ? heading[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim() : "";
    const text = part.replace(/<[^>]+>/g, "").trim();
    // A heading with nothing of its own under it ("Chapter 1 - Knowledge
    // Module 1") opens the next part rather than being a page of its own.
    if (text.length - title.length < 80) {
      carried += part;
      continue;
    }
    chapters.push({ title: title || (chapters.length === 0 ? "Opening pages" : `Part ${chapters.length + 1}`), html: carried + part });
    carried = "";
  }
  if (carried && chapters.length > 0) chapters[chapters.length - 1].html += carried;
  else if (carried) chapters.push({ title: "The guide", html: carried });
  return chapters;
}
