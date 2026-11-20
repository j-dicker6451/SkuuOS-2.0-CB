// SPDX-License-Identifier: AGPL-3.0-only

import {
  createReadonlyPool,
  type ReadonlyDb,
  withReadOnlyTransaction
} from "@skuu/readonly";
import type { Pool } from "pg";

export type McpReadContext = {
  pool: Pool;
  query: <T>(fn: (db: ReadonlyDb) => Promise<T>) => Promise<T>;
};

let shared: McpReadContext | null = null;

export function getMcpContext(): McpReadContext {
  if (!shared) {
    const pool = createReadonlyPool();
    shared = {
      pool,
      query: (fn) => withReadOnlyTransaction(pool, fn)
    };
  }
  return shared;
}
