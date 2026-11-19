// SPDX-License-Identifier: AGPL-3.0-only

import type { Kysely, Transaction } from "kysely";
import type { KyselyDatabase } from "@carbon/database/client";

/** DB tables/columns used by the spike harness before they land in generated Kysely types. */
export type SkuuFormulaPhaseTable = {
  makeMethodId: string;
  phaseNumber: number;
  companyId: string;
  methodOperationId?: string | null;
  instructions?: string | null;
  createdAt?: string;
  createdBy: string;
  updatedAt?: string | null;
  updatedBy: string;
};

export type SkuuJobMaterialDispenseTable = {
  id?: string;
  jobMaterialId: string;
  companyId: string;
  trackedEntityId?: string | null;
  quantityKg: number;
  supplierBatchNumber?: string | null;
  storageLocationId?: string | null;
  sortOrder?: number;
  createdAt?: string;
  createdBy: string;
};

type BaseSkuuMethodMaterialFormula = KyselyDatabase["skuuMethodMaterialFormula"];

export type SpikeKyselyDatabase = Omit<
  KyselyDatabase,
  "skuuMethodMaterialFormula"
> & {
  skuuFormulaPhase: SkuuFormulaPhaseTable;
  skuuJobMaterialDispense: SkuuJobMaterialDispenseTable;
  skuuMethodMaterialFormula: BaseSkuuMethodMaterialFormula & {
    phaseNumber?: number | null;
    lineKind?: "ingredient" | "bulk_lot_rework";
    sourceTrackedEntityId?: string | null;
    reworkPercentWw?: number | null;
  };
};

export type SpikeDb = Kysely<SpikeKyselyDatabase>;
export type SpikeTrx = Transaction<SpikeKyselyDatabase>;

export function asSpikeDb(db: Kysely<KyselyDatabase>): SpikeDb {
  return db as unknown as SpikeDb;
}

export function asSpikeTrx(trx: Transaction<KyselyDatabase>): SpikeTrx {
  return trx as unknown as SpikeTrx;
}