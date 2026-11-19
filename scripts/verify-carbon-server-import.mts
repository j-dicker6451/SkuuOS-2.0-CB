import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
process.env.SESSION_SECRET ??= "local-dev-stub-secret-0123456789abcdef";
process.env.CARBON_EDITION ??= "community";

await import(path.join(root, "../apps/erp/app/modules/carbon.server.ts"));
console.log("[ok] carbon.server.ts evaluated");