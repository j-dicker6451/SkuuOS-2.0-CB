// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuBeaker,
  LuBox,
  LuChartLine,
  LuClipboardCheck,
  LuFileText,
  LuLayers,
  LuReceipt,
  LuShoppingCart,
  LuTags
} from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
import { DETAIL_TAB_SHORTCUTS } from "~/shortcuts";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import type { PartSummary } from "../../types";
import { usePartLayoutData } from "./usePartLayoutData";

export function usePartNavigation() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = usePartLayoutData<{ partSummary: PartSummary }>();
  const partSummary = routeData?.partSummary;
  if (!partSummary?.replenishmentSystem) {
    return [
      {
        name: t`Details`,
        to: path.to.partDetails(itemId),
        icon: LuFileText,
        shortcut: DETAIL_TAB_SHORTCUTS.details
      }
    ];
  }
  if (!partSummary.itemTrackingType) {
    return [
      {
        name: t`Details`,
        to: path.to.partDetails(itemId),
        icon: LuFileText,
        shortcut: DETAIL_TAB_SHORTCUTS.details
      }
    ];
  }

  const replenishment = partSummary.replenishmentSystem;
  const itemTrackingType = partSummary.itemTrackingType;
  const unitOfMeasure = partSummary.unitOfMeasureCode ?? "";
  const readableId = partSummary.readableId ?? "";
  const isBulkSku =
    replenishment === "Make" &&
    (unitOfMeasure === "kg" || readableId.startsWith("BULK-"));
  const isFgSku =
    replenishment === "Make" &&
    (unitOfMeasure === "EA" || readableId.startsWith("FG-"));

  return [
    {
      name: t`Details`,
      to: path.to.partDetails(itemId),
      icon: LuFileText,
      shortcut: DETAIL_TAB_SHORTCUTS.details
    },
    ...(isBulkSku
      ? [
          {
            name: t`Formulation & method`,
            to: path.to.partFormulation(itemId),
            icon: LuBeaker,
            isActive: (pathname: string) =>
              pathname === path.to.partFormulation(itemId) ||
              pathname.startsWith(`${path.to.partFormulation(itemId)}/`)
          }
        ]
      : []),
    ...(isFgSku
      ? [
          {
            name: t`Product build`,
            to: path.to.partProductBuild(itemId),
            icon: LuLayers,
            isActive: (pathname: string) =>
              pathname === path.to.partProductBuild(itemId) ||
              pathname.startsWith(`${path.to.partProductBuild(itemId)}/`)
          }
        ]
      : []),
    {
      name: t`Purchasing`,
      to: path.to.partPurchasing(itemId),
      isDisabled: replenishment === "Make",
      role: ["employee", "supplier"],
      permission: "purchasing",
      icon: LuShoppingCart,
      shortcut: DETAIL_TAB_SHORTCUTS.purchasing
    },
    {
      name: t`Accounting`,
      to: path.to.partCosting(itemId),
      role: ["employee"],
      permission: "purchasing",
      icon: LuTags,
      shortcut: DETAIL_TAB_SHORTCUTS.accounting
    },
    {
      name: t`Planning`,
      to: path.to.partPlanning(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee"],
      icon: LuChartLine,
      shortcut: DETAIL_TAB_SHORTCUTS.planning
    },
    {
      name: t`Inventory`,
      to: path.to.partInventory(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: DETAIL_TAB_SHORTCUTS.inventory
    },
    {
      name: t`Sales`,
      to: path.to.partSales(itemId),
      role: ["employee", "customer"],
      icon: LuReceipt,
      shortcut: DETAIL_TAB_SHORTCUTS.sales
    },
    {
      name: t`Quality`,
      to: path.to.partQuality(itemId),
      role: ["employee"],
      permission: "quality",
      icon: LuClipboardCheck,
      shortcut: DETAIL_TAB_SHORTCUTS.quality
    }
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role))) &&
      (item.permission === undefined ||
        permissions.can("view", item.permission))
  );
}
