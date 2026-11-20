// SPDX-License-Identifier: AGPL-3.0-only

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export { default } from "./new-product.wizard";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "parts" });
  return {};
}
