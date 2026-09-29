/**
 * Rewrites lib/i18n/en-server.ts, the catalogue of messages the server writes.
 * Job sheet D9, stage 5. See scripts/server-phrases.ts.
 *
 *   npm run translations:server
 */
import { writeFileSync } from "node:fs";
import { collect, OUTPUT, renderCatalogue } from "./server-phrases";

const phrases = collect();
writeFileSync(OUTPUT, renderCatalogue(phrases));
console.log(`${OUTPUT}: ${phrases.length} phrases from ${new Set(phrases.map((phrase) => phrase.file)).size} files.`);
