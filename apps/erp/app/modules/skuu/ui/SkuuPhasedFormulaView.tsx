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
  Tr,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { formatMassQuantityKg, formatPercentWw } from "@skuu/formula";
import type { SkuuPhasedFormulaBlock } from "../skuu-phased-formula";

type Props = {
  title?: string;
  blocks: SkuuPhasedFormulaBlock[];
};

export function SkuuPhasedFormulaView({ title, blocks }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? <Trans>Formula by phase</Trans>}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {blocks.map((block) => (
          <section key={block.phaseNumber} className="border rounded-md p-4">
            <h3 className="font-medium mb-1">
              <Trans>Phase {block.phaseNumber}</Trans>
            </h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground mb-3">
              {block.instructions}
            </p>
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
                    <Trans>% w/w</Trans>
                  </Th>
                  <Th>
                    <Trans>kg / batch</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {block.lines.length === 0 ? (
                  <Tr>
                    <Td colSpan={4}>
                      <Trans>No ingredients in this phase.</Trans>
                    </Td>
                  </Tr>
                ) : (
                  block.lines.map((line) => (
                    <Tr key={line.methodMaterialId}>
                      <Td>{line.itemReadableId}</Td>
                      <Td>{line.itemName}</Td>
                      <Td>{formatPercentWw(line.percentWw)}</Td>
                      <Td>{formatMassQuantityKg(line.kgPerBatch)}</Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

export function SkuuPhasedFormulaStack({
  blocks
}: {
  blocks: SkuuPhasedFormulaBlock[];
}) {
  return (
    <VStack className="gap-4">
      <SkuuPhasedFormulaView blocks={blocks} />
    </VStack>
  );
}
