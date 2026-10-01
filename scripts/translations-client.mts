/**
 * Rewrites lib/i18n/client-keys.ts, the phrases a browser can ask for.
 * Job sheet D9. See scripts/client-phrases.ts.
 *
 *   npm run translations:client
 */
import { writeFileSync } from "node:fs";
import { CLIENT_OUTPUT, clientPhrases, renderClientKeys } from "./client-phrases";

const found = clientPhrases();
writeFileSync(CLIENT_OUTPUT, renderClientKeys(found));
console.log(`${CLIENT_OUTPUT}: ${found.keys.length} keys and ${found.prefixes.length} prefixes.`);
