// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { getMakeMethodsOnce } from "~/modules/items/items.service";
import type { PartSummary } from "~/modules/items/types";
import { usePartLayoutData } from "~/modules/items/ui/Parts/usePartLayoutData";
import { loadSkuuFormulationView } from "~/modules/skuu/skuu-formulation.service";
import { SkuuFormulationMethodPanel } from "~/modules/skuu/ui/SkuuFormulationMethodPanel";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const { itemId } = params;
  if (!itemId) throw new Error("itemId required");

  const methods = await getMakeMethodsOnce(client, itemId, companyId);
  const active =
    methods.data?.find((m) => m.status === "Active") ?? methods.data?.[0];
  if (!active) {
    return { makeMethodId: null, view: null };
  }

  const view = await loadSkuuFormulationView(client, active.id, companyId);
  return { makeMethodId: active.id, view, methodStatus: active.status };
}

export default function PartFormulationRoute() {
  const { t } = useLingui();
  const { itemId } = useParams();
  const data = useLoaderData<typeof loader>();
  const layout = usePartLayoutData<{ partSummary: PartSummary }>();
  const readableId = layout?.partSummary?.readableId ?? itemId ?? "";

  if (!data.makeMethodId) {
    return (
      <VStack className="gap-2 p-4">
        <h1 className="text-lg font-semibold">
          {t`Formulation & method`} — {readableId}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t`Add an active method of manufacture on the Details tab first, then enable the bulk formula here.`}
        </p>
      </VStack>
    );
  }

  const view = data.view;
  if (!view) {
    return (
      <VStack className="gap-2 p-4">
        <h1 className="text-lg font-semibold">
          {t`Formulation & method`} — {readableId}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t`Could not load formulation data for this method.`}
        </p>
      </VStack>
    );
  }

  return (
    <VStack className="gap-4 p-4">
      <h1 className="text-lg font-semibold">
        {t`Formulation & method`} — {readableId}
      </h1>
      <SkuuFormulationMethodPanel
        makeMethodId={data.makeMethodId}
        profile={view.profile}
        phases={view.phases.map((p) => ({
          phaseNumber: p.phaseNumber,
          instructions: p.instructions
        }))}
        materials={view.materials}
      />
    </VStack>
  );
}
