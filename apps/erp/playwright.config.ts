// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 120_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure"
  },
  reporter: [["list"]]
});