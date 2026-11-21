// SPDX-License-Identifier: AGPL-3.0-only

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { z } from "zod";
import type { ActionFunctionArgs } from "react-router";
import { requestReferrer, path } from "~/utils/path";

const skuuFormulationVersionNewValidator = z.object({
  sourceMakeMethodId: z.string().min(1),
  itemId: z.string().min(1),
  changeReason: z.string().min(1).max(4000)
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(skuuFormulationVersionNewValidator).request(
    args
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.skuu.createSkuuFormulationVersionFn(input.data);
  if (result.data?.makeMethodId) {
    return respond(args.request, result).redirect(
      `${path.to.partFormulation(input.data.itemId)}?makeMethodId=${result.data.makeMethodId}`
    );
  }
  return respond(args.request, result).redirect(requestReferrer(args.request));
}