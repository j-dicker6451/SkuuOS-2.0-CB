// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { getMakeMethodsOnce } from "~/modules/items/items.service";
import type { PartSummary } from "~/modules/items/types";
import { loadSkuuFormulationView } from "~/modules/skuu/skuu-formulation.service";
import { SkuuFormulationMethodPanel } from "~/modules/skuu/ui/SkuuFormulationMethodPanel";
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
  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId!)
  );

  if (!data.makeMethodId || !data.view) {
    return (
      <p>
        {t`Add an active method of manufacture on the Details tab first, then enable the bulk formula here.`}
      </p>
    );
  }

  return (
    <VStack className="gap-4 p-4">
      <h1 className="text-lg font-semibold">
        {t`Formulation & method`} — {routeData?.partSummary.readableId}
      </h1>
      <SkuuFormulationMethodPanel
        makeMethodId={data.makeMethodId}
        profile={data.view.profile}
        phases={data.view.phases.map((p) => ({
          phaseNumber: p.phaseNumber,
          instructions: p.instructions
        }))}
        materials={data.view.materials}
      />
    </VStack>
  );
}
