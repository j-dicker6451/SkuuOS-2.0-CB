// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

/** SkuuOS merchandising tags stored on part/material `tags` text arrays. */
export const SKUU_ITEM_TAGS = ["Bulk", "Packaging", "Finished Good"] as const;

export type SkuuItemTag = (typeof SKUU_ITEM_TAGS)[number];

export const skuuItemTagSchema = z.enum(SKUU_ITEM_TAGS);

export function itemExtensionTable(
  type: "Part" | "Material" | "Consumable"
): "part" | "material" | "consumable" {
  switch (type) {
    case "Material":
      return "material";
    case "Consumable":
      return "consumable";
    default:
      return "part";
  }
}
