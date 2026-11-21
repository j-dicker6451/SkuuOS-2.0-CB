// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, HStack, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { getMakeMethodsOnce } from "~/modules/items/items.service";
import type { PartSummary } from "~/modules/items/types";
import { usePartLayoutData } from "~/modules/items/ui/Parts/usePartLayoutData";
import { findLatestSkuuBulkJobForItem } from "~/modules/skuu/skuu-job-bulk.server";
import { loadSkuuFormulationView } from "~/modules/skuu/skuu-formulation.service";
import {
  computeSkuuFormulationDiff,
  listSkuuFormulationRevisionsForItem,
  resolveSkuuFormulationStatus
} from "~/modules/skuu/skuu-formulation-change-control.service";
import { SkuuFormulationMethodPanel } from "~/modules/skuu/ui/SkuuFormulationMethodPanel";
import { SkuuFormulationVersionPanel } from "~/modules/skuu/ui/SkuuFormulationVersionPanel";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const { itemId } = params;
  if (!itemId) throw new Error("itemId required");

  const url = new URL(request.url);
  const makeMethodIdParam = url.searchParams.get("makeMethodId");

  const methods = await getMakeMethodsOnce(client, itemId, companyId);
  const active =
    methods.data?.find((m) => m.status === "Active") ?? methods.data?.[0];

  const selected =
    (makeMethodIdParam &&
      methods.data?.find((m) => m.id === makeMethodIdParam)) ??
    active;

  if (!selected) {
    return { makeMethodId: null, view: null, revisions: [], formulationStatus: "draft", diff: null, version: null };
  }

  const [view, revisions, formulationStatus] = await Promise.all([
    loadSkuuFormulationView(client, selected.id, companyId),
    listSkuuFormulationRevisionsForItem(client, itemId, companyId),
    resolveSkuuFormulationStatus(client, selected.id, companyId)
  ]);

  const revision = revisions.find((r) => r.makeMethodId === selected.id);
  let diff = null;
  if (revision?.sourceMakeMethodId) {
    diff = await computeSkuuFormulationDiff(
      client,
      revision.sourceMakeMethodId,
      selected.id,
      companyId
    );
  }

  const latestBulkJob = view.profile?.enabled
    ? await findLatestSkuuBulkJobForItem(client, itemId, companyId)
    : null;

  return {
    makeMethodId: selected.id,
    view,
    methodStatus: selected.status,
    latestBulkJob,
    revisions,
    formulationStatus,
    diff,
    version: selected.version
  };
}

export default function PartFormulationRoute() {
  const { t } = useLingui();
  const { itemId } = useParams();
  const data = useLoaderData<typeof loader>();
  const layout = usePartLayoutData<{ partSummary: PartSummary }>();
  const readableId = layout?.partSummary?.readableId ?? itemId ?? "";
  const readOnly = data.formulationStatus !== "draft";

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
      <HStack className="flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">
          {t`Formulation & method`} — {readableId}
          {data.version != null ? ` · V${Number(data.version).toFixed(2)}` : ""}
        </h1>
        {data.latestBulkJob ? (
          <HStack className="gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link
                to={path.to.jobBulkBatchTicket(data.latestBulkJob.id)}
                target="_blank"
                rel="noreferrer"
              >
                <Trans>Batch ticket</Trans>
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to={path.to.jobBulkRecord(data.latestBulkJob.id)}>
                <Trans>Bulk batch record</Trans>
              </Link>
            </Button>
          </HStack>
        ) : null}
      </HStack>
      {view.profile?.enabled ? (
        <SkuuFormulationVersionPanel
          itemId={itemId!}
          revisions={data.revisions}
          diff={data.diff}
          selectedMakeMethodId={data.makeMethodId}
          formulationStatus={data.formulationStatus}
        />
      ) : null}
      <SkuuFormulationMethodPanel
        makeMethodId={data.makeMethodId}
        profile={view.profile}
        phases={view.phases.map((p) => ({
          phaseNumber: p.phaseNumber,
          instructions: p.instructions
        }))}
        materials={view.materials}
        readOnly={readOnly}
      />
    </VStack>
  );
}