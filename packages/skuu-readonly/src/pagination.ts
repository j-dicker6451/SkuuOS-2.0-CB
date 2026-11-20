// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0)
});

export type Pagination = z.infer<typeof paginationSchema>;

export function clampPagination(input: {
  limit?: number;
  offset?: number;
}): Pagination {
  return paginationSchema.parse({
    limit: input.limit ?? 25,
    offset: input.offset ?? 0
  });
}
