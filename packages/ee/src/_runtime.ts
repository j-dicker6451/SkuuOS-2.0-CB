/**
 * Shared runtime helpers for AGPLv3-safe Enterprise stubs (see NOTICE.md).
 */
// @ts-nocheck
import { z } from "zod";

export function permissiveSchema() {
  return z.object({}).passthrough();
}

export function reactStub(_displayName?: string) {
  const Stub = () => null;
  Stub.displayName = _displayName ?? "EnterpriseFeatureExcluded";
  return Stub;
}

export const reactNull = () => null;

export function asyncNoop(..._args: unknown[]) {
  return Promise.resolve(undefined);
}

export function asyncFalse(..._args: unknown[]) {
  return Promise.resolve(false);
}

export function asyncEmptyArray(..._args: unknown[]) {
  return Promise.resolve([]);
}

export function asyncEmptyObject(..._args: unknown[]) {
  return Promise.resolve({});
}

export function asyncNull(..._args: unknown[]) {
  return Promise.resolve(null);
}

export function fnFalse(..._args: unknown[]) {
  return false;
}

export function fnTrue(..._args: unknown[]) {
  return true;
}

export function fnEmptyArray(..._args: unknown[]) {
  return [];
}

export function fnEmptyObject(..._args: unknown[]) {
  return {};
}

export function fnNull(..._args: unknown[]) {
  return null;
}

export function fnUndefined(..._args: unknown[]) {
  return undefined;
}

const handler: ProxyHandler<object> = {
  get(target, prop) {
    if (prop === "then") return undefined;
    if (prop === "length") return 0;
    if (prop === Symbol.iterator) {
      return function* emptyIterator() {
        return;
      };
    }
    if (typeof prop === "string") {
      if (prop === "extend" || prop === "merge" || prop === "pick") {
        return () => permissiveSchema();
      }
      if (prop === "parse" || prop === "safeParse") {
        return () => ({ success: true as const, data: {} });
      }
      if (prop === "shape") return {};
      if (prop === "map" || prop === "filter" || prop === "flatMap") {
        return () => [];
      }
      if (prop === "find" || prop === "findIndex") {
        return () => undefined;
      }
      if (prop === "some" || prop === "every") {
        return () => false;
      }
      if (prop === "has") {
        return () => false;
      }
      if (prop === "get") {
        return () => undefined;
      }
    }
    return deepStub();
  },
  apply() {
    return undefined;
  }
};

export function deepStub(): unknown {
  const base = Object.assign(
    (..._args: unknown[]) => undefined,
    Array.from({ length: 0 })
  );
  return new Proxy(base, handler);
}

export function entityValue(entity: string, id: string) {
  return { kind: "entity" as const, entity, id };
}

export function primitiveValue(_type: string, value: unknown) {
  return { kind: "primitive" as const, type: _type, value };
}

export function listValue(items: unknown[] = []) {
  return { kind: "list" as const, items };
}

export function pairsValue(entries: unknown[] = []) {
  return { kind: "pairs" as const, entries };
}

export function recordValue(fields: Record<string, unknown> = {}) {
  return { kind: "record" as const, fields };
}

export function t(value: unknown) {
  return value;
}

export class StubError extends Error {
  constructor(message = "Enterprise feature is not available in this import.") {
    super(message);
    this.name = "StubError";
  }
}
