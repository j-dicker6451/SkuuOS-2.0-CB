/**
 * AGPLv3-safe compile stub — upstream Enterprise `@carbon/ee/integrations/connections` was excluded.
 * See NOTICE.md at the repository root.
 */
// @ts-nocheck
import * as rt from "../_runtime.ts";

export default rt.reactStub();
export class ConnectionAccountMismatchError extends rt.StubError {}
export class ConnectionAccountUnverifiedError extends rt.StubError {}
export class ConnectionNameTakenError extends rt.StubError {}
export class ConnectionRefreshTimeoutError extends rt.StubError {}
export class ConnectionRevokedError extends rt.StubError {}
export class ConnectionSecretUnavailableError extends rt.StubError {}
export class ConnectionWorkspaceTakenError extends rt.StubError {}
export type IntegrationConnection = Record<string, unknown>;
export const IntegrationConnection = class {} as any;
export type OAuth2RefreshConfig = (...args: unknown[]) => null;
export const OAuth2RefreshConfig = rt.reactStub("OAuth2RefreshConfig");
export const TOKEN_REQUEST_TIMEOUT_MS = {} as const;
export const connectionUsable = rt.deepStub;
export const connectionsHealthy = rt.deepStub;
export const createConnection = rt.deepStub;
export const disconnectConnection = rt.deepStub;
export const exchangeAuthorizationCode = rt.deepStub;
export const missingScopes = rt.deepStub;
export const needsReconnect = rt.deepStub;
export const readConnection = rt.deepStub;
export const readConnections = rt.deepStub;
export const renameConnection = rt.deepStub;
export const resolveConnectionAuth = rt.deepStub;
export const usableConnections = rt.deepStub;
