// Copies pdf.js's worker into public/ before every build, so the theory
// guide viewer (components/document-viewer.tsx) loads the worker of the very
// version installed. Run by npm as "prebuild"; the copy is not committed.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = join(dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
const target = join(process.cwd(), "public", "pdfjs", "pdf.worker.min.mjs");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`pdf.js worker copied to ${target}`);
