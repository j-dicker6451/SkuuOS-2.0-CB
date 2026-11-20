// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { loadSkuuBatchRecordView } from "~/modules/skuu/skuu-batch-record.service";
import { SkuuBulkBatchRecordPanel } from "~/modules/skuu/ui/SkuuBulkBatchRecordPanel";
import { usePermissions } from "~/hooks";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });
  const { jobId } = params;
  if (!jobId) throw new Response("Not found", { status: 404 });
  const view = await loadSkuuBatchRecordView(client, { jobId, companyId });
  if (!view) throw new Response("Not a Skuu bulk batch job", { status: 404 });
  return { view };
}

export default function JobBulkRecordRoute() {
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId required");
  const { view } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const readOnly = !permissions.can("update", "production");

  const done = view.phases.filter((p) => p.phaseComplete).length;
  const total = view.phases.length;

  return (
    <VStack className="gap-4 p-4">
      <h1 className="text-lg font-semibold">
        <Trans>Bulk batch record</Trans> ({done}/{total}{" "}
        <Trans>phases complete</Trans>)
      </h1>
      <SkuuBulkBatchRecordPanel jobId={jobId} view={view} readOnly={readOnly} />
    </VStack>
  );
}