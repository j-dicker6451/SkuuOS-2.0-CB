#!/usr/bin/env python3
"""Generate AGPL-safe, runtime-aware stubs for excluded Carbon Enterprise code."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Literal

ROOT = Path(__file__).resolve().parents[1]
EE_ROOT = ROOT / "packages" / "ee"
SRC = EE_ROOT / "src"
RUNTIME_PATH = SRC / "_runtime.ts"
# Hand-maintained stubs (AGPL-safe runtime); never overwritten by the generator.
HAND_AUTHORED_SUBPATHS = frozenset({"_runtime", "plan", "plan.server"})

Kind = Literal[
    "zod",
    "workflow_value",
    "workflow_handle",
    "react",
    "error",
    "array_const",
    "object_const",
    "integrations",
    "async_server",
    "async_string",
    "async_bool",
    "bool_fn",
    "noop_string_fn",
    "noop_fn",
    "class_type",
    "default",
]

WORKFLOW_VALUE_NAMES = {
    "entityValue",
    "primitiveValue",
    "listValue",
    "pairsValue",
    "recordValue",
    "t",
}

WORKFLOW_HANDLE_NAMES = {
    "SUCCESS_HANDLE",
    "FAILURE_HANDLE",
    "MAX_CHAIN_DEPTH",
    "MAX_LIST_ITEMS",
    "MAX_NODE_EXECUTIONS",
    "CURRENT_DEFINITION_FORMAT_VERSION",
    "CUSTOM_FIELD_PREFIX",
    "MCP_DEFAULT_LIMIT",
    "MCP_MAX_CHARS",
    "MCP_MAX_ROWS",
}

IMPORT_PATTERNS = [
    re.compile(r"import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
    re.compile(r"import\s+type\s+\{([^}]+)\}\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
    re.compile(r"import\s+(\w+)\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
    re.compile(r"import\s+\*\s+as\s+(\w+)\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
    re.compile(r"export\s+\{([^}]+)\}\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
]

USAGE_PATTERNS = {
    "zod_extend": re.compile(r"\b(\w+)\.extend\s*\("),
    "zod_merge": re.compile(r"\b(\w+)\.merge\s*\("),
    "zod_pick": re.compile(r"\b(\w+)\.pick\s*\("),
    "zod_parse": re.compile(r"\b(\w+)\.(?:parse|safeParse)\s*\("),
    "validator_wrap": re.compile(r"\bvalidator\s*\(\s*(\w+)\s*\)"),
    "jsx": re.compile(r"<\s*(\w+)(?:[\s/>{])"),
    "call": re.compile(r"\b(\w+)\s*\("),
    "array_map": re.compile(r"\b(\w+)\.map\s*\("),
    "array_filter": re.compile(r"\b(\w+)\.(?:filter|flatMap|some|every|find)\s*\("),
    "object_keys": re.compile(r"\bObject\.(?:keys|values|entries)\s*\(\s*(\w+)\s*\)"),
    "dot_prop": re.compile(r"\b(\w+)\.[\w$]+"),
    "new": re.compile(r"\bnew\s+(\w+)\s*\("),
    "spread": re.compile(r"\.\.\.(\w+)\b"),
    "string_method": re.compile(
        r"\b(\w+)\.(?:startsWith|endsWith|split|includes|match|trim|toLowerCase|toUpperCase)\b"
    ),
}

UI_EXTRA_SYMBOLS: dict[str, set[str]] = {
    "apps/erp/app/modules/production/ui/MachineTime/machine-time-filters.ee.ts": {
        "parseMachineTimeListFilters",
        "machineTimeQueueKeyset",
        "MachineTimeListFilters",
    },
    "apps/erp/app/modules/production/ui/MachineTime/machine-time-suggestions.ee.ts": {
        "suggestMachineTimeOperations",
        "MachineTimeSuggestion",
        "DayEvent",
    },
    "apps/erp/app/modules/production/ui/MachineTime/MachineTimeTable.ee.tsx": {
        "UnattributedMachineTime",
    },
}

EE_UI_PATHS = [
    "apps/erp/app/modules/accounting/ui/IndirectRates/BurdenSettingsForm.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/IceExport.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/IndirectExpenseStatement.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/IndirectPoolAccounts.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/IndirectPoolForm.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/IndirectPoolsTable.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/IndirectRateRuns.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/IndirectRatesGrid.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/IndirectRatesUpgradeOverlay.ee.tsx",
    "apps/erp/app/modules/accounting/ui/IndirectRates/SetIndirectRateModal.ee.tsx",
    "apps/erp/app/modules/accounting/ui/RevenueRecognition/ProjectRevenueProgress.ee.tsx",
    "apps/erp/app/modules/production/ui/MachineTime/MachineTimeDrawer.ee.tsx",
    "apps/erp/app/modules/production/ui/MachineTime/machine-time-filters.ee.ts",
    "apps/erp/app/modules/production/ui/MachineTime/machine-time-suggestions.ee.ts",
    "apps/erp/app/modules/production/ui/MachineTime/MachineTimeTable.ee.tsx",
    "apps/erp/app/modules/production/ui/MachineTime/MachineTimeUpgradeOverlay.ee.tsx",
    "apps/erp/app/modules/projects/ui/Costs/ProjectBurdenByPool.ee.tsx",
    "apps/erp/app/modules/projects/ui/Costs/ProjectEarnedValue.ee.tsx",
    "apps/erp/app/modules/projects/ui/Element/ElementEarnedValue.ee.tsx",
    "apps/erp/app/modules/projects/ui/Project/ProjectControlSettings.ee.tsx",
    "apps/erp/app/modules/projects/ui/Project/StopWorkModal.ee.tsx",
    "apps/erp/app/modules/sales/ui/Contracts/ContractFinancing.ee.tsx",
    "apps/erp/app/modules/sales/ui/Contracts/ContractFinancingRequest.ee.tsx",
    "apps/erp/app/modules/sales/ui/Contracts/ContractRateCeilings.ee.tsx",
    "apps/erp/app/modules/sales/ui/CustomerPortals/CustomerPortalForm.ee.tsx",
    "apps/erp/app/modules/sales/ui/CustomerPortals/CustomerPortalsTable.ee.tsx",
    "apps/erp/app/modules/settings/ui/Approvals/ApprovalRuleCard.ee.tsx",
    "apps/erp/app/modules/settings/ui/Approvals/ApprovalRuleDetails.ee.tsx",
    "apps/erp/app/modules/settings/ui/Approvals/ApprovalRuleForm.ee.tsx",
    "apps/erp/app/modules/settings/ui/Approvals/ApprovalRules.ee.tsx",
    "apps/erp/app/modules/settings/ui/Approvals/ApprovalRulesUpgradeOverlay.ee.tsx",
    "apps/erp/app/modules/settings/ui/Integrations/OeeDevices.ee.tsx",
    "apps/erp/app/modules/users/ui/Employees/BulkEditPermissionsForm.ee.tsx",
    "apps/erp/app/modules/users/ui/Employees/EmployeePermissionsForm.ee.tsx",
    "apps/erp/app/modules/users/ui/EmployeeTypes/EmployeeTypeForm.ee.tsx",
    "apps/erp/app/modules/users/ui/EmployeeTypes/EmployeeTypesTable.ee.tsx",
    "apps/erp/app/modules/users/ui/EmployeeTypes/EmployeeTypesUpgradeOverlay.ee.tsx",
]


def collect_symbols() -> dict[str, set[str]]:
    by_sub: dict[str, set[str]] = defaultdict(set)
    for path in ROOT.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if path.is_relative_to(SRC):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pat in IMPORT_PATTERNS:
            for m in pat.finditer(text):
                sub = m.group(2) or ""
                if sub.lstrip("/") == "_runtime":
                    continue
                if pat.pattern.startswith("import\\s+(\\w+)\\s+from"):
                    by_sub[sub].add("__default__")
                    continue
                if "* as" in pat.pattern:
                    by_sub[sub].add(f"__namespace__{m.group(1)}")
                    continue
                chunk = m.group(1)
                for part in chunk.split(","):
                    part = part.strip()
                    if not part or part.startswith("//"):
                        continue
                    name = part.split(" as ")[0].strip().replace("type ", "").strip()
                    if name:
                        by_sub[sub].add(name)
    _collect_dot_ee_exports(by_sub)
    _collect_tilde_ee_exports(by_sub)
    for rel, symbols in UI_EXTRA_SYMBOLS.items():
        by_sub[f"__ui__:{rel}"].update(symbols)
    return by_sub


def _collect_tilde_ee_exports(by_sub: dict[str, set[str]]) -> None:
    pat = re.compile(
        r"import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['\"]~/modules/([^'\"]*\.ee)['\"]",
        re.M,
    )
    for path in ROOT.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for m in pat.finditer(text):
            stub_key = None
            base = ROOT / "apps/erp/app/modules" / m.group(2)
            for suffix in (".ts", ".tsx"):
                candidate = Path(f"{base}{suffix}")
                if candidate.exists():
                    stub_key = f"__ui__:{candidate.relative_to(ROOT).as_posix()}"
                    break
            if stub_key is None:
                continue
            for part in m.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                name = part.split(" as ")[0].strip().replace("type ", "").strip()
                if name:
                    by_sub[stub_key].add(name)


def _collect_dot_ee_exports(by_sub: dict[str, set[str]]) -> None:
    pat = re.compile(r"import\s+\{([^}]+)\}\s+from\s+['\"](\./[^'\"]*\.ee)['\"]", re.M)
    for path in ROOT.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or ".ee." in path.name:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for m in pat.finditer(text):
            ee_base = path.parent / m.group(2).removeprefix("./")
            ee_rel = None
            for suffix in (".ts", ".tsx", ""):
                candidate = Path(str(ee_base) + suffix) if suffix else ee_base
                if candidate.exists():
                    ee_rel = candidate
                    break
            if ee_rel is None:
                continue
            stub_key = f"__ui__:{ee_rel.relative_to(ROOT)}"
            for part in m.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                name = part.split(" as ")[0].strip().replace("type ", "").strip()
                if name:
                    by_sub[stub_key].add(name)


def collect_usage() -> dict[tuple[str, str], set[str]]:
    usage: dict[tuple[str, str], set[str]] = defaultdict(set)
    for path in ROOT.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or path.is_relative_to(SRC):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        local_to_key: dict[str, tuple[str, str]] = {}
        default_key: tuple[str, str] | None = None
        for pat in IMPORT_PATTERNS:
            for m in pat.finditer(text):
                sub = m.group(2) or ""
                if pat.pattern.startswith("import\\s+(\\w+)\\s+from"):
                    default_key = (sub, "__default__")
                    local_to_key[m.group(1)] = default_key
                    continue
                if "* as" in pat.pattern:
                    continue
                chunk = m.group(1)
                for part in chunk.split(","):
                    part = part.strip()
                    if not part or part.startswith("//"):
                        continue
                    orig = part.split(" as ")[0].strip().replace("type ", "").strip()
                    local = part.split(" as ")[-1].strip()
                    if orig:
                        local_to_key[local] = (sub, orig)
        if not local_to_key:
            continue
        for tag, pat in USAGE_PATTERNS.items():
            for m in pat.finditer(text):
                name = m.group(1)
                if name in local_to_key:
                    usage[local_to_key[name]].add(tag)
    return usage


def classify(sub: str, name: str, tags: set[str]) -> Kind:
    if name in WORKFLOW_VALUE_NAMES:
        return "workflow_value"
    if name in WORKFLOW_HANDLE_NAMES:
        return "workflow_handle"
    if name.endswith("Error"):
        return "error"
    if name == "integrations":
        return "integrations"
    if (
        name.endswith("Validator")
        or name.endswith("Schema")
        or name.endswith("validator")
        or tags
        & {"zod_extend", "zod_merge", "zod_pick", "validator_wrap", "zod_parse"}
    ):
        return "zod"
    if tags & {"jsx"} and name[0:1].isupper():
        return "react"
    if name.endswith("Logo") or name in {"Email", "Onshape", "OnshapeGovernment", "StripeConnect"}:
        return "react"
    if name == "__default__":
        return "react"
    if tags & {"array_map", "array_filter", "spread"} and (
        name.isupper() or name.endswith("IDS") or name.endswith("EVENTS")
    ):
        return "array_const"
    if name.isupper() or name.endswith("_IDS") or name.endswith("_LABELS") or name.endswith("_TYPES"):
        return "object_const" if "array_map" not in tags else "array_const"
    if sub.endswith(".server") or "/hooks.server" in sub or name.endswith(".server"):
        if "string_method" in tags:
            return "async_string"
        return "async_server"
    if tags & {"string_method"} and not tags & {"call"}:
        return "noop_string_fn"
    if name.startswith("is") or name.startswith("has") or name.startswith("can"):
        return "bool_fn"
    if name.startswith("get") and name.endswith("Enabled"):
        return "bool_fn"
    if name[0:1].isupper() and not tags & {"call", "jsx", "dot_prop"}:
        return "class_type"
    if tags & {"call", "dot_prop"}:
        if sub.endswith(".server") or "server" in sub:
            return "async_server"
        return "noop_fn"
    return "noop_fn"


def runtime_import_for(target: Path) -> str:
    rel = target.relative_to(SRC)
    depth = len(rel.parts) - 1
    prefix = "../" * depth if depth > 0 else "./"
    return f"{prefix}_runtime.ts"


def emit_export(name: str, kind: Kind, rt_import: str) -> list[str]:
    if name.startswith("__namespace__"):
        ns = name.removeprefix("__namespace__")
        return [f"export * as {ns} from '{rt_import.replace('_runtime.ts', '_runtime.ts')}';"]
    match kind:
        case "zod":
            return [
                f"export type {name} = import('zod').ZodTypeAny;",
                f"export const {name} = rt.permissiveSchema();",
            ]
        case "workflow_value":
            fn_map = {
                "entityValue": "entityValue",
                "primitiveValue": "primitiveValue",
                "listValue": "listValue",
                "pairsValue": "pairsValue",
                "recordValue": "recordValue",
                "t": "t",
            }
            fn = fn_map.get(name, "fnUndefined")
            return [f"export const {name} = rt.{fn};"]
        case "workflow_handle":
            literal = {
                "SUCCESS_HANDLE": '"success"',
                "FAILURE_HANDLE": '"failure"',
                "MAX_CHAIN_DEPTH": "8",
                "MAX_LIST_ITEMS": "0",
                "MAX_NODE_EXECUTIONS": "0",
                "CURRENT_DEFINITION_FORMAT_VERSION": "1",
                "CUSTOM_FIELD_PREFIX": '"customField"',
                "MCP_DEFAULT_LIMIT": "20",
                "MCP_MAX_CHARS": "20000",
                "MCP_MAX_ROWS": "200",
            }.get(name, '""')
            return [f"export const {name} = {literal};"]
        case "react":
            if name == "__default__":
                return ["export default rt.reactStub();"]
            return [
                f"export type {name} = (...args: unknown[]) => null;",
                f"export const {name} = rt.reactStub({json.dumps(name)});",
            ]
        case "error":
            return [f"export class {name} extends rt.StubError {{}}"]
        case "integrations":
            return [
                "export type Integration = Record<string, unknown>;",
                "export const integrations: Integration[] = [];",
            ]
        case "array_const":
            return [f"export const {name}: unknown[] = [];"]
        case "object_const":
            return [f"export const {name} = {{}} as const;"]
        case "async_string":
            return [f"export const {name} = rt.asyncNull;"]
        case "async_bool":
            return [f"export const {name} = rt.asyncFalse;"]
        case "async_server":
            if name.startswith(("get", "load", "read", "fetch", "list", "build")):
                return [f"export const {name} = rt.asyncEmptyObject;"]
            if name.startswith(("create", "upsert", "insert", "ensure", "start")):
                return [f"export const {name} = rt.asyncEmptyObject;"]
            if name.startswith(("delete", "remove", "disable", "cancel", "revoke")):
                return [f"export const {name} = rt.asyncNoop;"]
            if name.startswith("require"):
                return [f"export const {name} = rt.asyncNoop;"]
            return [f"export const {name} = rt.asyncNoop;"]
        case "bool_fn":
            return [f"export const {name} = rt.fnFalse;"]
        case "noop_string_fn":
            return [
                f"export const {name} = (..._args: unknown[]) => \"\";",
            ]
        case "class_type":
            return [
                f"export type {name} = Record<string, unknown>;",
                f"export const {name} = class {{}} as any;",
            ]
        case "noop_fn":
            return [f"export const {name} = rt.deepStub;"]
        case _:
            return [f"export const {name} = rt.deepStub;"]


def write_module(sub: str, symbols: set[str], usage: dict[tuple[str, str], set[str]]) -> None:
    rel = sub.lstrip("/")
    target = SRC / f"{rel}.ts" if rel else SRC / "index.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    rt_import = runtime_import_for(target)
    header = f"""/**
 * AGPLv3-safe compile stub — upstream Enterprise `@carbon/ee/{rel or ''}` was excluded.
 * See NOTICE.md at the repository root.
 */
// @ts-nocheck
import * as rt from "{rt_import}";

"""
    lines = [header.rstrip(), ""]
    if "__default__" in symbols:
        lines.extend(emit_export("__default__", "react", rt_import))
    else:
        lines.append("export default rt.reactStub();")
    for sym in sorted(symbols):
        if sym in {"__default__", "__namespace__"} or sym.startswith("__namespace__"):
            continue
        kind = classify(sub, sym, usage.get((sub, sym), set()))
        lines.extend(emit_export(sym, kind, rt_import))
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_ee_package(by_sub: dict[str, set[str]], usage: dict[tuple[str, str], set[str]]) -> dict[str, int]:
    EE_ROOT.mkdir(parents=True, exist_ok=True)
    SRC.mkdir(exist_ok=True)
    kind_counts: dict[str, int] = defaultdict(int)
    exports: dict[str, str] = {".": "./src/index.ts", "./_runtime": "./src/_runtime.ts"}
    for sub, symbols in sorted(by_sub.items()):
        rel = sub.lstrip("/")
        if sub.startswith("__ui__"):
            continue
        if rel not in HAND_AUTHORED_SUBPATHS:
            write_module(sub, symbols, usage)
            for sym in symbols:
                if not sym.startswith("__"):
                    kind_counts[classify(sub, sym, usage.get((sub, sym), set()))] += 1
        if rel:
            exports[f"./{rel}"] = f"./src/{rel}.ts"
    for rel in sorted(HAND_AUTHORED_SUBPATHS - {"_runtime"}):
        exports[f"./{rel}"] = f"./src/{rel}.ts"
    pkg = {
        "name": "@carbon/ee",
        "private": True,
        "version": "0.0.0",
        "type": "module",
        "sideEffects": False,
        "description": "Compile-time stubs only; upstream Enterprise sources were excluded per NOTICE.md.",
        "exports": exports,
        "scripts": {
            "clean": "rimraf .turbo node_modules",
            "lint": "biome lint --write",
            "typecheck": "tsc --noEmit",
        },
        "dependencies": {
            "@carbon/auth": "workspace:*",
            "@carbon/database": "workspace:*",
            "@carbon/env": "workspace:*",
            "@carbon/utils": "workspace:*",
            "@supabase/supabase-js": "catalog:",
            "react": "catalog:",
            "zod": "catalog:",
        },
        "devDependencies": {
            "@carbon/config": "workspace:*",
            "typescript": "catalog:",
        },
    }
    (EE_ROOT / "package.json").write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
    (EE_ROOT / "tsconfig.json").write_text(
        json.dumps(
            {
                "extends": "@carbon/config/tsconfig/base.json",
                "include": ["src"],
                "exclude": ["dist", "build", "node_modules"],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return dict(kind_counts)


def write_ui_stubs(by_sub: dict[str, set[str]], usage: dict[tuple[str, str], set[str]]) -> None:
    for rel in EE_UI_PATHS:
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        stub_key = f"__ui__:{rel}"
        extras = by_sub.get(stub_key, set())
        header = f"""/**
 * AGPLv3-safe compile stub — upstream Enterprise UI was excluded from this import.
 * See NOTICE.md at the repository root.
 */
// @ts-nocheck
import * as rt from "@carbon/ee/_runtime";

export default rt.reactStub();
"""
        lines = [header.rstrip()]
        for sym in sorted(extras):
            if sym == "OeeDevices" and "OeeDevices" in rel:
                lines.append("export const OeeDevices = rt.reactStub('OeeDevices');")
                continue
            tags = usage.get(("", sym), set())
            if sym.endswith("Validator"):
                kind = "zod"
            elif sym.endswith("Keyset"):
                lines.extend(
                    [
                        f"export const {sym} = (..._args: unknown[]) => ({{",
                        "  above: 'and(id.eq.00000000-0000-0000-0000-000000000000)',",
                        "  below: 'and(id.eq.00000000-0000-0000-0000-000000000000)'",
                        "});",
                    ]
                )
                continue
            elif sym.startswith("parse") or sym.startswith("suggest"):
                kind = "noop_fn"
                lines.extend(
                    [
                        f"export const {sym} = (..._args: unknown[]) => ({{}});"
                    ]
                )
                continue
            elif sym[0:1].isupper() and "ListFilters" not in sym and sym.endswith(("Table", "Form", "Modal", "Drawer", "Overlay", "Grid")):
                kind = "react"
            elif sym[0:1].isupper() and tags & {"jsx"}:
                kind = "react"
            elif sym[0:1].isupper():
                kind = "class_type"
            else:
                kind = "noop_fn"
            lines.extend(emit_export(sym, kind, "@carbon/ee/_runtime"))
        if "OeeDevices" in rel and "OeeDevices" not in extras:
            lines.append("export const OeeDevices = rt.reactStub('OeeDevices');")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def patch_package_scripts() -> None:
    pkg_path = ROOT / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    pkg["scripts"]["check:workflow-catalog"] = (
        "echo 'Skipped: requires upstream packages/ee workflow catalog (excluded).'"
    )
    pkg["scripts"]["generate:workflow-catalog"] = (
        "echo 'Skipped: requires upstream packages/ee workflow catalog (excluded).'"
    )
    if "generate:oss-stubs" not in pkg.get("scripts", {}):
        pkg["scripts"]["generate:oss-stubs"] = "python3 scripts/generate-oss-stubs.py"
    if "verify:oss-stubs-runtime" not in pkg.get("scripts", {}):
        pkg["scripts"]["verify:oss-stubs-runtime"] = "node scripts/verify-server-import.mjs"
    pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    if not RUNTIME_PATH.exists():
        raise SystemExit(
            f"Missing {RUNTIME_PATH.relative_to(ROOT)} — restore before generating stubs."
        )
    by_sub = collect_symbols()
    by_sub.pop("_runtime", None)
    usage = collect_usage()
    for sub in (
        "",
        "/plan",
        "/plan.server",
        "/workflows",
        "/workflows.server",
        "/accounting",
        "/onshape",
        "/approvals",
    ):
        by_sub.setdefault(sub, set())
    kinds = write_ee_package(by_sub, usage)
    write_ui_stubs(by_sub, usage)
    patch_package_scripts()
    total = sum(len(v) for s, v in by_sub.items() if not s.startswith("__ui__"))
    print(
        f"Generated packages/ee stubs ({len(by_sub)} modules, {total} symbols) "
        f"and {len(EE_UI_PATHS)} UI .ee stubs"
    )
    print("Kinds:", ", ".join(f"{k}={v}" for k, v in sorted(kinds.items())))


if __name__ == "__main__":
    main()