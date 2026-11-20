// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatMassQuantityKg,
  formatPercentWw,
  grossInputKg,
  lineKgFromPercent,
  sumPercentWw,
  validatePercentSum
} from "@skuu/formula";
import { Hidden, Number as NumberField, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import {
  skuuFormulaPhaseValidator,
  skuuMaterialPercentValidator
} from "../skuu.models";
import type { SkuuBulkProfile } from "../skuu-bulk.service";
import type { SkuuFormulationMaterialLine } from "../skuu-formulation.service";
import { mergeSkuuFormulaPhases } from "../skuu-phased-formula";
import { SkuuBulkFormulaSection } from "./SkuuBulkFormulaSection";

type PhaseRow = {
  phaseNumber: number;
  instructions: string;
};

type Props = {
  makeMethodId: string;
  profile: SkuuBulkProfile | null;
  phases: PhaseRow[];
  materials: SkuuFormulationMaterialLine[];
  readOnly?: boolean;
};

function groupByPhase(materials: SkuuFormulationMaterialLine[]) {
  const map = new Map<number, SkuuFormulationMaterialLine[]>();
  for (const m of materials) {
    const phase = m.phaseNumber ?? 1;
    const list = map.get(phase) ?? [];
    list.push(m);
    map.set(phase, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

export function SkuuFormulationMethodPanel({
  makeMethodId,
  profile,
  phases,
  materials,
  readOnly
}: Props) {
  const { t } = useLingui();
  const enabled = profile?.enabled ?? false;
  const batchBasisKg = profile?.batchBasisKg ?? 1;
  const yieldPct = profile?.expectedYieldPercent ?? 100;
  const density = profile?.productDensityGPerMl ?? null;
  const grossBasis = enabled
    ? grossInputKg(batchBasisKg, yieldPct)
    : batchBasisKg;

  const check = validatePercentSum(
    materials.map((m) => ({
      id: m.methodMaterialId,
      percentWw: m.percentWw
    }))
  );
  const total = sumPercentWw(
    materials.map((m) => ({
      id: m.methodMaterialId,
      percentWw: m.percentWw
    }))
  );

  const phaseList = mergeSkuuFormulaPhases(phases, materials);

  const grouped = groupByPhase(materials);

  return (
    <VStack className="gap-6">
      <SkuuBulkFormulaSection
        makeMethodId={makeMethodId}
        enabled={enabled}
        batchBasisKg={batchBasisKg}
        productDensityGPerMl={density}
        expectedYieldPercent={yieldPct}
        materialPercents={materials.map((m) => ({
          methodMaterialId: m.methodMaterialId,
          percentWw: m.percentWw,
          phaseNumber: m.phaseNumber
        }))}
        readOnly={readOnly}
        hideMaterialLines
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Formulation & method of manufacture</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            <Trans>
              Standard batch{" "}
              {formatMassQuantityKg(batchBasisKg, {
                forceUnit: "kg"
              })}{" "}
              · gross {formatMassQuantityKg(grossBasis, { forceUnit: "kg" })} at{" "}
              {formatPercentWw(yieldPct)} yield
              {density != null ? ` · density ${density} g/mL` : ""}. Formula
              total {total.toFixed(2)}% {check.ok ? "(OK)" : "— needs 100%"}.
            </Trans>
          </p>

          {phaseList.map((phase) => (
            <div key={phase.phaseNumber} className="border rounded-md p-4">
              <h3 className="font-medium mb-2">
                <Trans>Phase {phase.phaseNumber}</Trans>
              </h3>
              {!readOnly && (
                <ValidatedForm
                  method="post"
                  action={path.to.skuuFormulaPhase}
                  validator={skuuFormulaPhaseValidator}
                  defaultValues={{
                    makeMethodId,
                    phaseNumber: phase.phaseNumber,
                    instructions: phase.instructions
                  }}
                  className="mb-4"
                >
                  <Hidden name="makeMethodId" />
                  <Hidden name="phaseNumber" />
                  <Textarea
                    name="instructions"
                    label={t`Method instructions (precautions, planning, protocol)`}
                    rows={4}
                  />
                  <Submit className="mt-2">
                    <Trans>Save phase instructions</Trans>
                  </Submit>
                </ValidatedForm>
              )}
              {readOnly && (
                <p className="text-sm whitespace-pre-wrap mb-4 text-muted-foreground">
                  {phase.instructions}
                </p>
              )}

              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Material code</Trans>
                    </Th>
                    <Th>
                      <Trans>Name</Trans>
                    </Th>
                    <Th>
                      <Trans>% w/w</Trans>
                    </Th>
                    <Th>
                      <Trans>kg / batch</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {(grouped.find(([n]) => n === phase.phaseNumber)?.[1] ?? [])
                    .length === 0 ? (
                    <Tr>
                      <Td colSpan={4}>
                        <Trans>No materials in this phase on the BOM.</Trans>
                      </Td>
                    </Tr>
                  ) : (
                    (
                      grouped.find(([n]) => n === phase.phaseNumber)?.[1] ?? []
                    ).map((m) => (
                      <Tr key={m.methodMaterialId}>
                        <Td>{m.itemReadableId}</Td>
                        <Td>{m.itemName}</Td>
                        <Td>
                          {!readOnly && enabled ? (
                            <ValidatedForm
                              method="post"
                              action={path.to.skuuBulkFormulaMaterial}
                              validator={skuuMaterialPercentValidator}
                              defaultValues={{
                                methodMaterialId: m.methodMaterialId,
                                percentWw: m.percentWw ?? undefined,
                                phaseNumber:
                                  m.phaseNumber ?? phase.phaseNumber
                              }}
                              className="flex gap-2 items-end"
                            >
                              <Hidden name="methodMaterialId" />
                              <NumberField
                                name="percentWw"
                                label={t`% w/w`}
                                minValue={0}
                                maxValue={100}
                                className="w-24"
                              />
                              <Hidden name="phaseNumber" />
                              <Submit isSmall>
                                <Trans>Save</Trans>
                              </Submit>
                            </ValidatedForm>
                          ) : m.percentWw != null ? (
                            formatPercentWw(Number(m.percentWw))
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td>
                          {m.percentWw != null
                            ? formatMassQuantityKg(
                                lineKgFromPercent(
                                  Number(m.percentWw),
                                  grossBasis
                                ),
                                { forceUnit: "kg" }
                              )
                            : "—"}
                        </Td>
                      </Tr>
                    ))
                  )}
                </Tbody>
              </Table>
            </div>
          ))}
        </CardContent>
      </Card>
    </VStack>
  );
}
