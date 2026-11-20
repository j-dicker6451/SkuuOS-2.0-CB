// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useSearchParams } from "react-router";
import { path } from "~/utils/path";

const STEPS = [
  {
    key: "1",
    title: "Bulk SKU",
    hint: "Create or open the bulk Part (Make, Batch, kg)."
  },
  {
    key: "2",
    title: "Formulation",
    hint: "Enter % w/w, phases, density, yield on Formulation & method."
  },
  {
    key: "3",
    title: "Method",
    hint: "Document precautions and protocol per phase."
  },
  {
    key: "4",
    title: "Finished goods",
    hint: "Create FG parts per pack size (Make, Batch, EA)."
  },
  {
    key: "5",
    title: "Packaging",
    hint: "On Product build, add buy packaging on the FG BOM."
  }
] as const;

export default function SkuuNewProductWizard() {
  const { t } = useLingui();
  const [params] = useSearchParams();
  const step = params.get("step") ?? "1";
  const bulkId = params.get("bulkItemId") ?? "";

  return (
    <VStack className="gap-6 p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">
        <Trans>New product (SkuuOS)</Trans>
      </h1>
      <ol className="list-decimal list-inside space-y-2 text-sm">
        {STEPS.map((s) => (
          <li key={s.key} className={step === s.key ? "font-semibold" : ""}>
            {s.title} — {s.hint}
          </li>
        ))}
      </ol>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Step {step}</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {step === "1" && (
            <>
              <p>
                <Trans>
                  Start with a new bulk Part or an existing BULK-* SKU.
                </Trans>
              </p>
              <Button asChild>
                <Link to={path.to.newPart}>
                  <Trans>Create bulk Part</Trans>
                </Link>
              </Button>
            </>
          )}
          {step === "2" && bulkId && (
            <Button asChild>
              <Link to={path.to.partFormulation(bulkId)}>
                <Trans>Open formulation & method</Trans>
              </Link>
            </Button>
          )}
          {step === "2" && !bulkId && (
            <p className="text-muted-foreground">
              {t`Pass ?bulkItemId= on the URL after you create the bulk part.`}
            </p>
          )}
          {step === "3" && bulkId && (
            <Button asChild>
              <Link to={path.to.partFormulation(bulkId)}>
                <Trans>Edit phase instructions</Trans>
              </Link>
            </Button>
          )}
          {step === "4" && (
            <Button asChild>
              <Link to={path.to.newPart}>
                <Trans>Create finished-good Part (EA)</Trans>
              </Link>
            </Button>
          )}
          {step === "5" && bulkId && (
            <Button asChild>
              <Link to={path.to.partProductBuild(bulkId)}>
                <Trans>Product build summary</Trans>
              </Link>
            </Button>
          )}
          <div className="flex gap-2 pt-4">
            {Number(step) > 1 && (
              <Button variant="outline" asChild>
                <Link
                  to={`${path.to.skuuNewProduct}?step=${Number(step) - 1}${bulkId ? `&bulkItemId=${bulkId}` : ""}`}
                >
                  <Trans>Back</Trans>
                </Link>
              </Button>
            )}
            {Number(step) < 5 && (
              <Button asChild>
                <Link
                  to={`${path.to.skuuNewProduct}?step=${Number(step) + 1}${bulkId ? `&bulkItemId=${bulkId}` : ""}`}
                >
                  <Trans>Next</Trans>
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </VStack>
  );
}
