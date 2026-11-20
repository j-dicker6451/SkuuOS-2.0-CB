// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { MethodMaterial } from "~/modules/items/types";

type Props = {
  productCode: string;
  packSizeMl?: number | null;
  densityGPerMl?: number | null;
  bulkCode?: string | null;
  bulkName?: string | null;
  materials: Array<
    Pick<MethodMaterial, "id" | "itemId" | "quantity" | "itemType"> & {
      readableId?: string | null;
      name?: string | null;
      replenishmentSystem?: string | null;
    }
  >;
};

export function SkuuProductBuildPanel({
  productCode,
  packSizeMl,
  densityGPerMl,
  bulkCode,
  bulkName,
  materials
}: Props) {
  const kgPerUnit =
    packSizeMl && densityGPerMl ? (packSizeMl * densityGPerMl) / 1000 : null;

  const bulkLines = materials.filter(
    (m) => m.itemType !== "Material" && bulkCode && m.readableId === bulkCode
  );
  const packaging = materials.filter(
    (m) =>
      m.replenishmentSystem === "Buy" ||
      (m.itemType === "Part" && m.readableId !== bulkCode)
  );
  const bulkRow =
    bulkLines[0] ?? materials.find((m) => m.readableId === bulkCode);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Product build</Trans> — {productCode}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          {packSizeMl != null ? (
            <Trans>
              Fill {packSizeMl} mL
              {kgPerUnit != null
                ? ` · ${kgPerUnit.toFixed(4)} kg bulk per unit @ ${densityGPerMl} g/mL`
                : ""}
            </Trans>
          ) : (
            <Trans>
              Set pack size on the make method BOM to see bulk kg per unit.
            </Trans>
          )}
        </p>
        <h3 className="font-medium mb-2">
          <Trans>Bulk</Trans>
        </h3>
        <Table className="mb-6">
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Code</Trans>
              </TableHead>
              <TableHead>
                <Trans>Name</Trans>
              </TableHead>
              <TableHead>
                <Trans>Qty / unit</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>{bulkCode ?? bulkRow?.readableId ?? "—"}</TableCell>
              <TableCell>{bulkName ?? bulkRow?.name ?? "—"}</TableCell>
              <TableCell>
                {kgPerUnit != null
                  ? `${kgPerUnit.toFixed(4)} kg`
                  : (bulkRow?.quantity ?? "—")}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <h3 className="font-medium mb-2">
          <Trans>Packaging</Trans>
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Code</Trans>
              </TableHead>
              <TableHead>
                <Trans>Name</Trans>
              </TableHead>
              <TableHead>
                <Trans>Qty / unit</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packaging.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <Trans>
                    Add buy Parts (bottle, pump, label, carton) on the method
                    BOM.
                  </Trans>
                </TableCell>
              </TableRow>
            ) : (
              packaging.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.readableId}</TableCell>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>{m.quantity}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
