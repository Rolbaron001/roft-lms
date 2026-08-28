/**
 * Checks that this installation can actually read a PDF.
 *
 * Run inside the running application image, after a deploy, because that is
 * the only place the answer means anything. pdf.js reaches its optional canvas
 * dependency through a require that Next's file tracing cannot follow, so the
 * production image can end up without it while every test, every build and
 * every development run passes — and the first person to learn that PDFs are
 * unreadable is whoever uploads one.
 *
 * It builds a tiny PDF here rather than carrying a fixture, so there is no
 * file to lose, and it exercises the two things that break separately: the
 * module loading at all, and text actually coming back out.
 *
 *   node scripts/smoke-pdf.mjs
 */

// A minimal one-page PDF containing the word "roft". Written out by hand
// because a fixture file would not survive the standalone build's file
// tracing either, which is the very problem being tested for.
function tinyPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 24 Tf 20 100 Td (roft) Tj ET";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

async function main() {
  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    console.error("The PDF reader will not load, so no PDF can be read here.");
    console.error(String(error));
    console.error(
      "\nIf this says DOMMatrix is not defined, @napi-rs/canvas is missing\n" +
        "from the image. The Dockerfile copies it in deliberately; check that\n" +
        "the copy is still there and that the deps stage still installs it.",
    );
    process.exit(1);
  }

  const document = await pdfjs.getDocument({
    data: tinyPdf(),
    useSystemFonts: false,
    useWorkerFetch: false,
  }).promise;

  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map((item) => item.str ?? "").join("");

  if (!text.includes("roft")) {
    console.error(
      `The reader loaded but returned no text (got ${JSON.stringify(text)}).`,
    );
    process.exit(1);
  }

  console.log(`PDF reading works. ${document.numPages} page, text extracted.`);
}

main().catch((error) => {
  console.error("The PDF smoke check failed.");
  console.error(error);
  process.exit(1);
});
