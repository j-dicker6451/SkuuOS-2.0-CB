// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Textarea,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatMassQuantityKg, formatPercentWw } from "@skuu/formula";
import {
  Boolean as BooleanField,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { formatSkuuMaterialLotCodes } from "~/modules/items/material-line-label";
import { path } from "~/utils/path";
import {
  skuuBatchRecordCompleteValidator,
  skuuDispenseMarkValidator,
  skuuDispenseRowValidator
} from "../skuu.models";
import type { SkuuBatchRecordView } from "../skuu-batch-record.service";

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
                  {formatPercentWw(line.percentWw)} ·{" "}
                  {formatMassQuantityKg(line.plannedKg, { forceUnit: "kg" })}{" "}
                  planned
                </p>
                {line.dispenses.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {formatSkuuMaterialLotCodes(
                      line.dispenses.map((d) => ({
                        trackedEntityReadableId: d.trackedEntityReadableId,
                        supplierBatchNumber: d.supplierBatchNumber,
                        quantityKg: d.quantityKg
                      }))
                    )}
                  </p>
                ) : null}
                {line.dispenses.map((d) => (
                  <HStack
                    key={d.id}
                    className="gap-2 items-center mt-2 flex-wrap"
                  >
                    <span className="text-xs">
                      {formatMassQuantityKg(d.quantityKg, { forceUnit: "kg" })}
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
                        <BooleanField
                          name="markedAdded"
                          label={t`Added to tank`}
                        />
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
                      supplierBatchNumber: line.issuedLotHint ?? ""
                    }}
                    className="mt-2 flex flex-wrap gap-2 items-end"
                  >
                    <Hidden name="jobId" />
                    <Hidden name="jobMaterialId" />
                    <Input
                      name="quantityKg"
                      label={t`Actual kg`}
                      type="number"
                      step="0.001"
                      placeholder={`${formatMassQuantityKg(line.plannedKg, {
                        forceUnit: "kg"
                      })} planned`}
                    />
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
