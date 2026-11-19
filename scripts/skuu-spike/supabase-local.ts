// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync } from "node:fs";
import type { Database } from "@carbon/database";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function readEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m?.[1] && m[2] !== undefined) {
        env[m[1]] ??= m[2].trim();
      }
    }
  }
  return env;
}

export function spikeServiceRoleClient(): SupabaseClient<Database> | null {
  const env = { ...process.env, ...readEnvLocal() };
  const port = env.PORT_API;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!port || !key) return null;
  return createClient<Database>(`http://127.0.0.1:${port}`, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}