// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Form, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { SkuuFormulationDiffEntry } from "../skuu-formulation-diff";
import type { SkuuFormulationRevisionRow } from "../skuu-formulation-change-control.service";
import { path } from "~/utils/path";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  superseded: "Superseded",
  withdrawn: "Withdrawn"
};

type Props = {
  itemId: string;
  revisions: SkuuFormulationRevisionRow[];
  diff?: SkuuFormulationDiffEntry[] | null;
  selectedMakeMethodId: string;
  formulationStatus: string;
};

export function SkuuFormulationVersionPanel({
  itemId,
  revisions,
  diff,
  selectedMakeMethodId,
  formulationStatus
}: Props) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canApprove = permissions.can("update", "quality");
  const approvedRow = revisions.find((r) => r.status === "approved");
  const showCreateFromApproved =
    approvedRow != null && formulationStatus === "approved";

  return (
    <VStack className="gap-4 w-full">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Formulation version control</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <Trans>
              Approved versions are read-only. Create a new draft version with a
              reason to change % w/w, phases, yield, or density.
            </Trans>
          </p>
          {formulationStatus === "draft" ? (
            <Form method="post" action={path.to.skuuFormulationSubmit}>
              <Hidden name="makeMethodId" value={selectedMakeMethodId} />
              <Submit>
                <Trans>Submit for approval</Trans>
              </Submit>
            </Form>
          ) : null}
          {canApprove &&
          (formulationStatus === "pending_approval" ||
            formulationStatus === "draft") ? (
            <Form method="post" action={path.to.skuuFormulationApprove}>
              <Hidden name="makeMethodId" value={selectedMakeMethodId} />
              <Submit>
                <Trans>Approve version</Trans>
              </Submit>
            </Form>
          ) : null}
          {showCreateFromApproved && approvedRow ? (
            <Form
              method="post"
              action={path.to.skuuFormulationVersionNew}
              className="flex flex-col gap-2 max-w-lg"
            >
              <Hidden name="sourceMakeMethodId" value={approvedRow.makeMethodId} />
              <Hidden name="itemId" value={itemId} />
              <Input
                name="changeReason"
                label={t`Reason for new version`}
                required
              />
              <Submit>
                <Trans>Create new version (draft)</Trans>
              </Submit>
            </Form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Version history</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Version</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
                <Th>
                  <Trans>Reason</Trans>
                </Th>
                <Th>
                  <Trans>Approved</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {revisions.map((row) => (
                <Tr key={row.makeMethodId}>
                  <Td>
                    V{row.version.toFixed(2)}
                    {row.makeMethodId === selectedMakeMethodId ? (
                      <Badge className="ml-2" variant="secondary">
                        <Trans>Viewing</Trans>
                      </Badge>
                    ) : (
                      <a
                        className="ml-2 text-xs underline"
                        href={`?makeMethodId=${row.makeMethodId}`}
                      >
                        <Trans>Open</Trans>
                      </a>
                    )}
                  </Td>
                  <Td>{STATUS_LABEL[row.status] ?? row.status}</Td>
                  <Td className="max-w-xs truncate">{row.changeReason}</Td>
                  <Td className="text-xs text-muted-foreground">
                    {row.approvedAt
                      ? new Date(row.approvedAt).toLocaleString()
                      : "—"}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          {diff?.length ? (
            <div className="mt-4 text-sm">
              <p className="font-medium mb-1">
                <Trans>Changes vs previous version</Trans>
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {diff.map((d, i) => (
                  <li key={i}>
                    {d.kind === "added" && (
                      <Trans>
                        Added {d.line.itemReadableId ?? d.line.methodMaterialId}{" "}
                        at {d.line.percentWw ?? "—"}%
                      </Trans>
                    )}
                    {d.kind === "removed" && (
                      <Trans>
                        Removed {d.line.itemReadableId ?? d.line.methodMaterialId}
                      </Trans>
                    )}
                    {d.kind === "changed" && (
                      <Trans>
                        {d.line.itemReadableId ?? d.line.methodMaterialId}:{" "}
                        {d.previousPercentWw}% → {d.line.percentWw}%
                      </Trans>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </VStack>
  );
}