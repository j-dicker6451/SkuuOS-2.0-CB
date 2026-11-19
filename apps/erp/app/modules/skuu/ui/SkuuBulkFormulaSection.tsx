// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatDispensedAmounts,
  grossInputKg,
  lineKgFromPercent,
  sumPercentWw,
  validatePercentSum
} from "@skuu/formula";
import { Boolean, Hidden, Number, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import {
  skuuBulkProfileValidator,
  skuuMaterialPercentValidator
} from "../skuu.models";

type SkuuBulkFormulaSectionProps = {
  makeMethodId: string;
  enabled: boolean;
  batchBasisKg: number;
  productDensityGPerMl: number | null;
  expectedYieldPercent: number;
  materialPercents: Array<{
    methodMaterialId: string;
    percentWw: number | null;
    phaseNumber?: number | null;
  }>;
  readOnly?: boolean;
};

export function SkuuBulkFormulaSection({
  makeMethodId,
  enabled,
  batchBasisKg,
  productDensityGPerMl,
  expectedYieldPercent,
  materialPercents,
  readOnly
}: SkuuBulkFormulaSectionProps) {
  const { t } = useLingui();
  const total = sumPercentWw(
    materialPercents.map((m) => ({
      id: m.methodMaterialId,
      percentWw: m.percentWw
    }))
  );
  const check = validatePercentSum(
    materialPercents.map((m) => ({
      id: m.methodMaterialId,
      percentWw: m.percentWw
    }))
  );
  const grossBasisKg = enabled
    ? grossInputKg(batchBasisKg, expectedYieldPercent)
    : batchBasisKg;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Bulk formula (% w/w) — SkuuOS</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ValidatedForm
          method="post"
          action={path.to.skuuBulkFormula}
          validator={skuuBulkProfileValidator}
          defaultValues={{
            makeMethodId,
            enabled: enabled ? "on" : "",
            batchBasisKg,
            productDensityGPerMl: productDensityGPerMl ?? undefined,
            expectedYieldPercent
          }}
        >
          <Hidden name="makeMethodId" />
          {!readOnly && (
            <HStack className="gap-4 items-end flex-wrap">
              <Boolean name="enabled" label={t`Use % w/w formula`} />
              <Number
                name="batchBasisKg"
                label={t`Basis (kg)`}
                minValue={0.001}
              />
              <Number
                name="productDensityGPerMl"
                label={t`Density (g/mL)`}
                minValue={0.0001}
              />
              <Number
                name="expectedYieldPercent"
                label={t`Expected yield %`}
                minValue={0.01}
                maxValue={100}
              />
              <Submit>
                <Trans>Save bulk settings</Trans>
              </Submit>
            </HStack>
          )}
        </ValidatedForm>

        <p className="text-sm text-muted-foreground">
          <Trans>
            Enter each material line as % w/w (per basis kg). Running total:{" "}
            {total.toFixed(2)}%{" "}
            {check.ok ? "(OK)" : `— ${check.message ?? "out of range"}`}
          </Trans>
        </p>

        <p className="text-xs text-muted-foreground">
          <Trans>
            Manufacture = target ÷ (expected yield %). Density links L and kg on
            batch tickets.
          </Trans>
        </p>

        <div className="flex flex-col gap-2">
          {materialPercents.map((line) => {
            const preview =
              line.percentWw != null && enabled
                ? formatDispensedAmounts(
                    lineKgFromPercent(line.percentWw, grossBasisKg),
                    line.percentWw
                  )
                : null;
            return (
              <ValidatedForm
                key={line.methodMaterialId}
                method="post"
                action={path.to.skuuBulkFormulaMaterial}
                validator={skuuMaterialPercentValidator}
                defaultValues={{
                  methodMaterialId: line.methodMaterialId,
                  percentWw: line.percentWw ?? undefined
                }}
                className="flex flex-row gap-2 items-end"
              >
                <Hidden name="methodMaterialId" />
                <Number
                  name="percentWw"
                  label={t`% w/w`}
                  minValue={0}
                  maxValue={100}
                  isDisabled={!enabled || readOnly}
                />
                {!readOnly && enabled && (
                  <Submit>
                    <Trans>Save</Trans>
                  </Submit>
                )}
                {preview && (
                  <span className="text-xs text-muted-foreground pb-2">
                    {preview.percentWw}% net · {preview.kg} kg gross ·{" "}
                    {preview.g} g
                    {line.phaseNumber != null
                      ? ` · Phase ${line.phaseNumber}`
                      : ""}
                  </span>
                )}
              </ValidatedForm>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
