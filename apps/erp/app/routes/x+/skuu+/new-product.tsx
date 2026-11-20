// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  createSkuuProductFromWizard,
  searchWizardMaterials
} from "~/modules/skuu/skuu-product-wizard.server";
import {
  skuuProductWizardDraftSchema
} from "~/modules/skuu/skuu-product-wizard.models";
import { path } from "~/utils/path";

export { default } from "./new-product.wizard";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "parts" });
  const url = new URL(request.url);
  const initialStep = Math.min(
    7,
    Math.max(1, Number(url.searchParams.get("step") ?? "1"))
  );
  return { initialStep };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
    update: "parts"
  });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "searchMaterials") {
    const q = String(formData.get("q") ?? "");
    const materials = await searchWizardMaterials(client, companyId, q);
    return Response.json({ materials });
  }

  if (intent === "create") {
    const raw = String(formData.get("draft") ?? "");
    const parsed = skuuProductWizardDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.flatten().formErrors.join("; ") },
        { status: 400 }
      );
    }
    try {
      const result = await createSkuuProductFromWizard(
        client,
        companyId,
        userId,
        parsed.data
      );
      throw redirect(
        `${path.to.partFormulation(result.bulkItemId)}?created=1`
      );
    } catch (e) {
      if (e instanceof Response) throw e;
      const message = e instanceof Error ? e.message : "Create failed";
      return Response.json({ error: message }, { status: 400 });
    }
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}