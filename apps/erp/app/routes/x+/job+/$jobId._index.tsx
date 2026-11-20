// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { Navigate, useParams } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  throw redirect(path.to.jobDetails(jobId));
}

export const middleware = [redirectBeforeLoaders(loader)];

/** Client navigations to `/x/job/:id` still need an outlet while loaders settle. */
export default function JobIndexRedirect() {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Could not find jobId");
  return <Navigate to={path.to.jobDetails(jobId)} replace />;
}