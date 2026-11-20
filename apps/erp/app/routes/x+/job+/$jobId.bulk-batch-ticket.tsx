// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { formatMassQuantityKg, formatPercentWw } from "@skuu/formula";
import { formatSkuuMaterialLotCodes } from "~/modules/items/material-line-label";
import { buildBulkBatchTicket } from "~/modules/skuu/skuu-batch-ticket.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true
  });
  const { jobId } = params;
  if (!jobId) throw new Response("Not found", { status: 404 });
  const ticket = await buildBulkBatchTicket(client, { jobId, companyId });
  if (!ticket) throw new Response("Not a Skuu bulk job", { status: 404 });
  return { ticket };
}

export default function BulkBatchTicketPrint() {
  const { ticket } = useLoaderData<typeof loader>();

  return (
    <div className="print-ticket p-8 max-w-4xl mx-auto text-sm">
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none; }
        }
        .print-ticket table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .print-ticket th, .print-ticket td { border: 1px solid #333; padding: 4px 6px; text-align: left; }
        .qc-box { border: 1px solid #333; min-height: 48px; margin-top: 4px; }
      `}</style>
      <button
        type="button"
        className="no-print mb-4 underline"
        onClick={() => window.print()}
      >
        Print batch ticket
      </button>
      <header className="mb-6">
        <h1 className="text-xl font-bold">SkuuOS bulk batch ticket</h1>
        <p>
          <strong>Product:</strong> {ticket.productCode} · {ticket.productName}
        </p>
        <p>
          <strong>Batch no.:</strong> {ticket.batchNumber}
        </p>
        <p>
          <strong>Batch size:</strong> {ticket.batchHeaderLabel}
        </p>
        <p>
          <strong>Expected yield:</strong> {ticket.expectedYieldPercent}% ·
          Formula total {ticket.percentTotal.toFixed(2)}%
        </p>
      </header>

      {ticket.phases.map((phase) => (
            <section key={phase.phaseNumber} className="mb-6">
              <h2 className="font-semibold">Phase {phase.phaseNumber}</h2>
              {phase.instructions ? (
                <pre className="whitespace-pre-wrap text-xs mb-2">
                  {phase.instructions}
                </pre>
              ) : null}
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Name</th>
                    <th>% w/w</th>
                    <th>kg</th>
                    <th>Supplier batch</th>
                    <th>Lot / location</th>
                  </tr>
                </thead>
                <tbody>
                  {phase.lines.map((line) => (
                    <tr key={`${phase.phaseNumber}-${line.partCode}`}>
                      <td>{line.partCode}</td>
                      <td>{line.name}</td>
                      <td>{formatPercentWw(line.percentWw)}</td>
                      <td>
                        {formatMassQuantityKg(line.kg, { forceUnit: "kg" })}
                      </td>
                      <td>
                        {line.batchLots
                          .map((l) => l.supplierBatchNumber)
                          .filter(Boolean)
                          .join("; ")}
                      </td>
                      <td>{formatSkuuMaterialLotCodes(line.batchLots)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
      ))}

      <section>
        <h2 className="font-semibold mb-2">In-process QC &amp; release</h2>
        {[
          "pH",
          "Viscosity",
          "Appearance",
          "Adjustments",
          "Retained sample",
          "Actual yield %",
          "Release",
          "Operator signature",
          "Supervisor signature"
        ].map((label) => (
          <div key={label} className="mb-2">
            <strong>{label}</strong>
            <div className="qc-box" />
          </div>
        ))}
      </section>
    </div>
  );
}
