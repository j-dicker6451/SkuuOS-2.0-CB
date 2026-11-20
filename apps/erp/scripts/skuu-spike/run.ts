#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { bootstrapSpikeEnv } from "./env-bootstrap";

bootstrapSpikeEnv();

const { main } = await import("./main.ts");
await main();