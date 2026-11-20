// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { formatMassQuantityKg } from "@skuu/formula";
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
                ? ` · ${formatMassQuantityKg(kgPerUnit, { forceUnit: "kg" })} bulk per unit @ ${densityGPerMl} g/mL`
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
          <Thead>
            <Tr>
              <Th>
                <Trans>Code</Trans>
              </Th>
              <Th>
                <Trans>Name</Trans>
              </Th>
              <Th>
                <Trans>Qty / unit</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td>{bulkCode ?? bulkRow?.readableId ?? "—"}</Td>
              <Td>{bulkName ?? bulkRow?.name ?? "—"}</Td>
              <Td>
                {kgPerUnit != null
                  ? formatMassQuantityKg(kgPerUnit, { forceUnit: "kg" })
                  : (bulkRow?.quantity ?? "—")}
              </Td>
            </Tr>
          </Tbody>
        </Table>

        <h3 className="font-medium mb-2">
          <Trans>Packaging</Trans>
        </h3>
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Code</Trans>
              </Th>
              <Th>
                <Trans>Name</Trans>
              </Th>
              <Th>
                <Trans>Qty / unit</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {packaging.length === 0 ? (
              <Tr>
                <Td colSpan={3}>
                  <Trans>
                    Add buy Parts (bottle, pump, label, carton) on the method
                    BOM.
                  </Trans>
                </Td>
              </Tr>
            ) : (
              packaging.map((m) => (
                <Tr key={m.id}>
                  <Td>{m.readableId}</Td>
                  <Td>{m.name}</Td>
                  <Td>{m.quantity}</Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
