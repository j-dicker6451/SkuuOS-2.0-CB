// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Textarea,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Boolean, Hidden, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import type { SkuuBatchRecordView } from "../skuu-batch-record.service";
import {
  skuuBatchRecordCompleteValidator,
  skuuDispenseMarkValidator,
  skuuDispenseRowValidator
} from "../skuu.models";

type Props = {
  jobId: string;
  view: SkuuBatchRecordView;
  readOnly?: boolean;
};

export function SkuuBulkBatchRecordPanel({ jobId, view, readOnly }: Props) {
  const { t } = useLingui();

  return (
    <VStack className="gap-6">
      {view.phases.map((phase) => (
        <Card key={phase.phaseNumber}>
          <CardHeader>
            <HStack className="justify-between items-center w-full">
              <CardTitle>
                <Trans>Phase {phase.phaseNumber}</Trans>
              </CardTitle>
              {phase.phaseComplete ? (
                <Badge variant="success">
                  <Trans>Phase complete</Trans>
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <Trans>In progress</Trans>
                </Badge>
              )}
            </HStack>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {phase.instructions}
            </p>

            {phase.lines.map((line) => (
              <div key={line.jobMaterialId} className="border rounded-md p-3">
                <p className="font-medium text-sm">
                  {line.itemReadableId} · {line.itemName} ·{" "}
                  {line.percentWw.toFixed(4)}% · {line.plannedKg.toFixed(4)} kg
                  planned
                </p>
                {line.dispenses.map((d) => (
                  <HStack key={d.id} className="gap-2 items-center mt-2 flex-wrap">
                    <span className="text-xs">
                      {d.quantityKg.toFixed(4)} kg
                      {d.supplierBatchNumber
                        ? ` · lot ${d.supplierBatchNumber}`
                        : ""}
                    </span>
                    {!readOnly && !phase.locked && (
                      <ValidatedForm
                        method="post"
                        action={path.to.skuuJobBatchRecord}
                        validator={skuuDispenseMarkValidator}
                        defaultValues={{
                          jobId,
                          dispenseId: d.id,
                          markedAdded: d.markedAdded ? "on" : ""
                        }}
                        className="flex items-center gap-2"
                      >
                        <Hidden name="jobId" />
                        <Hidden name="dispenseId" />
                        <Boolean name="markedAdded" label={t`Added to tank`} />
                        <Submit isSmall>
                          <Trans>Save</Trans>
                        </Submit>
                      </ValidatedForm>
                    )}
                    {d.markedAdded && d.addedAt && (
                      <Badge variant="outline">
                        <Trans>Logged</Trans>
                      </Badge>
                    )}
                  </HStack>
                ))}
                {!readOnly && !phase.locked && (
                  <ValidatedForm
                    method="post"
                    action={path.to.skuuJobBatchRecord}
                    validator={skuuDispenseRowValidator}
                    defaultValues={{
                      jobId,
                      jobMaterialId: line.jobMaterialId,
                      quantityKg: line.plannedKg,
                      supplierBatchNumber: ""
                    }}
                    className="mt-2 flex flex-wrap gap-2 items-end"
                  >
                    <Hidden name="jobId" />
                    <Hidden name="jobMaterialId" />
                    <Input name="quantityKg" label={t`Actual kg`} type="number" />
                    <Input
                      name="supplierBatchNumber"
                      label={t`Supplier batch / lot`}
                    />
                    <Submit isSmall>
                      <Trans>Add lot row</Trans>
                    </Submit>
                  </ValidatedForm>
                )}
              </div>
            ))}

            {!readOnly && (
              <ValidatedForm
                method="post"
                action={path.to.skuuJobBatchRecord}
                validator={skuuBatchRecordCompleteValidator}
                defaultValues={{
                  jobId,
                  phaseNumber: phase.phaseNumber,
                  notes: phase.notes ?? ""
                }}
              >
                <Hidden name="jobId" />
                <Hidden name="phaseNumber" />
                <Textarea name="notes" label={t`Phase notes`} rows={2} />
                {phase.locked ? (
                  <Input
                    name="correctionReason"
                    label={t`Correction reason (required to edit locked phase)`}
                  />
                ) : null}
                <Submit className="mt-2" disabled={phase.locked}>
                  <Trans>Mark phase complete</Trans>
                </Submit>
              </ValidatedForm>
            )}
          </CardContent>
        </Card>
      ))}
    </VStack>
  );
}