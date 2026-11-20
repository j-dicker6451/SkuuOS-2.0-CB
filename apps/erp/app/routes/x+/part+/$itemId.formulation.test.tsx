// SPDX-License-Identifier: AGPL-3.0-only

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RouteObject } from "react-router";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider
} from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PartSummary } from "~/modules/items/types";
import { path } from "~/utils/path";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (literals: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: literals }, ...values)
  })
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("~/modules/items/items.service", () => ({
  getMakeMethodsOnce: vi.fn()
}));
vi.mock("~/modules/skuu/skuu-formulation.service", () => ({
  loadSkuuFormulationView: vi.fn()
}));
vi.mock("~/modules/skuu/ui/SkuuFormulationMethodPanel", () => ({
  SkuuFormulationMethodPanel: () => <div data-testid="skuu-formula-panel" />
}));

import PartFormulationRoute from "./$itemId.formulation";

const bulkId = "item_EL64Jer7rGqUo2jN7a7GHq";
const partSummary: PartSummary = {
  id: bulkId,
  readableId: "BULK-PLUS01-18-T",
  readableIdWithRevision: "BULK-PLUS01-18-T",
  name: "Demo bulk",
  replenishmentSystem: "Make",
  itemTrackingType: "Lot",
  unitOfMeasureCode: "kg"
} as PartSummary;

beforeAll(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

async function renderAt(formulationLoaderData: {
  makeMethodId: string | null;
  view: unknown;
}) {
  const routes: RouteObject[] = [
    {
      id: "routes/x+/part+/$itemId",
      path: "/x/part/:itemId",
      loader: () => ({ partSummary }),
      children: [
        {
          id: "routes/x+/part+/$itemId.formulation",
          path: "formulation",
          loader: () => formulationLoaderData,
          element: (
            <I18nProvider i18n={i18n}>
              <PartFormulationRoute />
            </I18nProvider>
          )
        }
      ]
    }
  ];

  const handler = createStaticHandler(routes);
  const context = await handler.query(
    new Request(`http://localhost${path.to.partFormulation(bulkId)}`)
  );
  if (context instanceof Response) throw new Error("unexpected redirect");

  return renderToStaticMarkup(
    <StaticRouterProvider
      router={createStaticRouter(handler.dataRoutes, context)}
      context={context}
      hydrate={false}
    />
  );
}

describe("PartFormulationRoute", () => {
  it("shows the no-method fallback for a seeded bulk", async () => {
    const html = await renderAt({ makeMethodId: null, view: null });
    expect(html).toMatch(/Formulation &amp; method/);
    expect(html).toMatch(/BULK-PLUS01-18-T/);
    expect(html).toMatch(/Add an active method of manufacture/);
  });

  it("renders the formulation panel when a method is present", async () => {
    const html = await renderAt({
      makeMethodId: "mm_test",
      view: {
        profile: { enabled: true, batchBasisKg: 100, expectedYieldPercent: 98 },
        phases: [{ phaseNumber: 1, instructions: "" }],
        materials: []
      }
    });
    expect(html).toContain('data-testid="skuu-formula-panel"');
  });
});
