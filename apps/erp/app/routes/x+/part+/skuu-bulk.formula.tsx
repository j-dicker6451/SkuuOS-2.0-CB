// SPDX-License-Identifier: AGPL-3.0-only

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { skuuBulkProfileValidator } from "~/modules/skuu/skuu.models";
import { requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(skuuBulkProfileValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.skuu.saveSkuuBulkProfile(input.data);
  return respond(args.request, result).redirect(requestReferrer(args.request));
}
