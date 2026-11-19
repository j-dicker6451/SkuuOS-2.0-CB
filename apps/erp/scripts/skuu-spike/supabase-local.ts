// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function spikeSupabaseOrigin(): string | null {
  const port = process.env.PORT_API;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!port || !key) return null;
  const override = process.env.SKUU_SPIKE_SUPABASE_URL?.trim();
  if (override) return new URL(override).origin;
  if (process.env.SUPABASE_URL) {
    return new URL(process.env.SUPABASE_URL).origin;
  }
  return `http://127.0.0.1:${port}`;
}

export function spikeServiceRoleClient(): SupabaseClient<Database> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const host = spikeSupabaseOrigin();
  if (!host || !key) return null;
  return createClient<Database>(host, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/** Hint when PostgREST returns 401 (common when another process shadows :54321). */
export function spikeAuthHint(message: string): string {
  if (!/unauthorized/i.test(message)) return message;
  return (
    `${message}\n` +
    "Spike auth: check which process owns port 54321 (e.g. `lsof -nP -iTCP:54321 -sTCP:LISTEN`). " +
    "Cursor Agents Window on 127.0.0.1 can shadow Docker Supabase — try SKUU_SPIKE_SUPABASE_URL=http://[::1]:54321"
  );
}