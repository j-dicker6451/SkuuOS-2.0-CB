// SPDX-License-Identifier: AGPL-3.0-only

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { z } from "zod";
import type { ActionFunctionArgs } from "react-router";
import { requestReferrer } from "~/utils/path";

const skuuFormulationApproveValidator = z.object({
  makeMethodId: z.string().min(1)
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(skuuFormulationApproveValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.skuu.approveSkuuFormulationVersionFn(input.data);
  return respond(args.request, result).redirect(requestReferrer(args.request));
}