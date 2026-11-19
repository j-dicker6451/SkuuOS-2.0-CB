// SPDX-License-Identifier: AGPL-3.0-only

import vitestConfig from "./vitest.config.ts";

export default {
  ...vitestConfig,
  test: {
    ...vitestConfig.test,
    // Spike is not in the app/** test glob; run it in its own project.
    projects: undefined,
    include: ["scripts/skuu-spike/**/*.test.ts"],
    passWithNoTests: false,
    // Root `.env` / `.env.local` values must win over the unit-test stubs.
    env: {
      ...vitestConfig.test?.env,
      SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_API_URL: process.env.SUPABASE_API_URL,
      SESSION_SECRET: process.env.SESSION_SECRET,
      REDIS_URL: process.env.REDIS_URL,
    },
  },
};