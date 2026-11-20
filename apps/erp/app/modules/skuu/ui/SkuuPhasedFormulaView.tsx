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
  TableRow,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { formatMassQuantityKg, formatPercentWw4 } from "@skuu/formula";
import type { SkuuPhasedFormulaBlock } from "../skuu-phased-formula";

type Props = {
  title?: string;
  blocks: SkuuPhasedFormulaBlock[];
};

export function SkuuPhasedFormulaView({ title, blocks }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title ?? <Trans>Formula by phase</Trans>}
        </CardTitle>
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
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>Code</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Name</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>% w/w</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>kg / batch</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {block.lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Trans>No ingredients in this phase.</Trans>
                    </TableCell>
                  </TableRow>
                ) : (
                  block.lines.map((line) => (
                    <TableRow key={line.methodMaterialId}>
                      <TableCell>{line.itemReadableId}</TableCell>
                      <TableCell>{line.itemName}</TableCell>
                      <TableCell>{formatPercentWw4(line.percentWw)}</TableCell>
                      <TableCell>
                        {formatMassQuantityKg(line.kgPerBatch)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

export function SkuuPhasedFormulaStack({ blocks }: { blocks: SkuuPhasedFormulaBlock[] }) {
  return (
    <VStack className="gap-4">
      <SkuuPhasedFormulaView blocks={blocks} />
    </VStack>
  );
}