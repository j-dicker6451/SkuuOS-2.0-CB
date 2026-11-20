// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

export const companyIdSchema = z
  .string()
  .min(1)
  .describe("Tenant company id — all reads are scoped to this company.");

export const paginationInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Page size (max 100)."),
  offset: z.number().int().min(0).default(0).describe("Row offset.")
};

export const itemTypeFilter = z
  .enum(["Material", "Part", "Consumable"])
  .optional();

export const skuuTagFilter = z
  .enum(["Bulk", "Packaging", "Finished Good"])
  .optional();
