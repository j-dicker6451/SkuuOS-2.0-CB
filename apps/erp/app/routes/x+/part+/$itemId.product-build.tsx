// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getMakeMethodsOnce,
  getMethodMaterialsByMakeMethod
} from "~/modules/items/items.service";
import type { PartSummary } from "~/modules/items/types";
import { SkuuProductBuildPanel } from "~/modules/skuu/ui/SkuuProductBuildPanel";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const { itemId } = params;
  if (!itemId) throw new Error("itemId required");

  const methods = await getMakeMethodsOnce(client, itemId, companyId);
  const active =
    methods.data?.find((m) => m.status === "Active") ?? methods.data?.[0];
  if (!active) return { materials: [], packSizeMl: null, bulkLink: null };

  const mats = await getMethodMaterialsByMakeMethod(client, active.id);
  const lines = mats.data ?? [];

  const enriched = await Promise.all(
    lines.map(async (line) => {
      const { data: item } = await client
        .from("item")
        .select("readableId, name, replenishmentSystem")
        .eq("id", line.itemId)
        .single();
      return {
        ...line,
        readableId: item?.readableId,
        name: item?.name,
        replenishmentSystem: item?.replenishmentSystem
      };
    })
  );

  const bulkComponent = enriched.find(
    (m) => m.itemType === "Part" && Number(m.quantity) > 0 && m.quantity < 5
  );

  return {
    materials: enriched,
    packSizeMl: null,
    bulkLink: bulkComponent
      ? { code: bulkComponent.readableId, name: bulkComponent.name }
      : null
  };
}

export default function PartProductBuildRoute() {
  const { t } = useLingui();
  const { itemId } = useParams();
  const data = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId!)
  );

  return (
    <VStack className="gap-4 p-4">
      <h1 className="text-lg font-semibold">
        {t`Product build`} — {routeData?.partSummary.readableId}
      </h1>
      <SkuuProductBuildPanel
        productCode={routeData?.partSummary.readableId ?? ""}
        packSizeMl={data.packSizeMl}
        bulkCode={data.bulkLink?.code}
        bulkName={data.bulkLink?.name}
        materials={data.materials}
      />
    </VStack>
  );
}
