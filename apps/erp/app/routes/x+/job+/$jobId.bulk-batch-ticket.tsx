// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { buildBulkBatchTicket } from "~/modules/skuu/skuu-batch-ticket.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
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
        <h1 className="text-xl font-bold">SkuuOS — Bulk batch ticket</h1>
        <p>
          <strong>Product:</strong> {ticket.productCode} — {ticket.productName}
        </p>
        <p>
          <strong>Batch no.:</strong> {ticket.batchNumber}
        </p>
        <p>
          <strong>Batch size:</strong> {ticket.batchSizeKg.toFixed(4)} kg target
          {ticket.batchSizeL != null
            ? ` (${ticket.batchSizeL.toFixed(4)} L gross @ ${ticket.densityGPerMl} g/mL)`
            : ""}
        </p>
        <p>
          <strong>Expected yield:</strong> {ticket.expectedYieldPercent}% ·
          Formula total {ticket.percentTotal.toFixed(2)}%
        </p>
      </header>

      {[...ticket.linesByPhase.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([phaseNo, lines]) => {
          const phase = ticket.phases.find((p) => p.phaseNumber === phaseNo);
          return (
            <section key={phaseNo} className="mb-6">
              <h2 className="font-semibold">Phase {phaseNo}</h2>
              {phase?.instructions ? (
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
                    <th>g</th>
                    <th>Supplier batch</th>
                    <th>Lot / location</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.partCode}>
                      <td>{line.partCode}</td>
                      <td>{line.name}</td>
                      <td>{line.percentWw.toFixed(4)}</td>
                      <td>{line.kg.toFixed(4)}</td>
                      <td>{line.grams.toFixed(2)}</td>
                      <td />
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}

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
