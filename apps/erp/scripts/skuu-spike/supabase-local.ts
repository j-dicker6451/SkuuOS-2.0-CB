// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function spikeServiceRoleClient(): SupabaseClient<Database> | null {
  const port = process.env.PORT_API;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!port || !key) return null;
  const host = process.env.SUPABASE_URL
    ? new URL(process.env.SUPABASE_URL).origin
    : `http://127.0.0.1:${port}`;
  return createClient<Database>(host, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}