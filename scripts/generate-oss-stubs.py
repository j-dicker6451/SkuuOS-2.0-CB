#!/usr/bin/env python3
"""Generate AGPL-safe stubs for excluded Carbon Enterprise code (import helper)."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EE_ROOT = ROOT / "packages" / "ee"
SRC = EE_ROOT / "src"

IMPORT_PATTERNS = [
    re.compile(r"import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
    re.compile(r"import\s+type\s+\{([^}]+)\}\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
    re.compile(r"import\s+(\w+)\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
    re.compile(r"import\s+\*\s+as\s+(\w+)\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M),
    re.compile(
        r"export\s+\{([^}]+)\}\s+from\s+['\"]@carbon/ee([^'\"]*)['\"]", re.M
    ),
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
                if pat.pattern.startswith("import\\s+(\\w+)"):
                    by_sub[sub].add(m.group(1))
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
    return by_sub


def _collect_dot_ee_exports(by_sub: dict[str, set[str]]) -> None:
    pat = re.compile(
        r"import\s+\{([^}]+)\}\s+from\s+['\"](\./[^'\"]*\.ee)['\"]", re.M
    )
    for path in ROOT.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or path.name.endswith(".ee.ts"):
            continue
        if ".ee." in path.name:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for m in pat.finditer(text):
            ee_base = path.parent / (m.group(2).removeprefix("./"))
            ee_rel = ee_base
            for suffix in (".ts", ".tsx", ""):
                candidate = Path(str(ee_base) + suffix) if suffix else ee_base
                if candidate.exists():
                    ee_rel = candidate
                    break
            else:
                continue
            stub_key = f"__ui__:{ee_rel.relative_to(ROOT)}"
            for part in m.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                name = part.split(" as ")[0].strip().replace("type ", "").strip()
                if name:
                    by_sub[stub_key].add(name)


def is_likely_type(name: str) -> bool:
    if name.startswith("__"):
        return False
    return name[0].isupper() and not name.endswith("Error")


def emit_value(name: str) -> str:
    if name.startswith("__namespace__"):
        ns = name.removeprefix("__namespace__")
        return f"export * as {ns} from '../_runtime.ts';"
    if is_likely_type(name):
        return f"export type {name} = any;\nexport const {name} = class {{}} as any;"
    if name.endswith("Validator") or name.startswith("is") or name.startswith("has") or name.startswith("can"):
        return f"export const {name} = (..._args: unknown[]) => false as any;"
    if name.endswith("Error"):
        return f"export class {name} extends Error {{}}"
    if name.endswith("Schema") or name.endswith("Labels") or name.endswith("Types") or name.endswith("IDS") or "CONST" in name or name.isupper():
        return f"export const {name} = {{}} as const;"
    return f"export const {name} = (..._args: unknown[]) => undefined as any;"


def module_header(rel: str) -> str:
    return f"""/**
 * AGPLv3-safe compile stub — upstream Enterprise `@carbon/ee/{rel}` was excluded.
 * See NOTICE.md at the repository root.
 */
// @ts-nocheck
"""


def write_module(sub: str, symbols: set[str]) -> None:
    rel = sub.lstrip("/")
    path = SRC / f"{rel}.ts" if rel else SRC / "index.ts"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [module_header(rel or "index"), "export {};", "export default {};",]
    for sym in sorted(symbols):
        if sym.startswith("__namespace__"):
            continue
        lines.append(emit_value(sym))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


RUNTIME = """/**
 * Shared runtime placeholders for namespace imports.
 */
// @ts-nocheck
export const placeholder = new Proxy(
  () => undefined,
  {
    get: () => placeholder,
    apply: () => undefined,
  }
);
"""


EE_TS_FILTERS_STUB = """/**
 * AGPLv3-safe compile stub — upstream Enterprise UI was excluded from this import.
 */
// @ts-nocheck
export function parseMachineTimeListFilters() { return {}; }
export type MachineTimeSuggestion = unknown;
export type DayEvent = unknown;
export function suggestMachineTimeOperations() { return []; }
export type UnattributedMachineTime = unknown;
export type ProjectBurdenPoolRow = Record<string, unknown>;
export const FinancingStatus = {};
"""

EE_TSX_STUB = """/**
 * AGPLv3-safe compile stub — upstream Enterprise UI was excluded from this import.
 * See NOTICE.md at the repository root.
 */
// @ts-nocheck
export default function EnterpriseFeatureExcludedStub() {
  return null;
}
export type StubRecord = Record<string, unknown>;
"""

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


def write_ee_package(by_sub: dict[str, set[str]]) -> None:
    EE_ROOT.mkdir(parents=True, exist_ok=True)
    SRC.mkdir(exist_ok=True)
    (SRC / "_runtime.ts").write_text(RUNTIME, encoding="utf-8")

    exports: dict[str, str] = {".": "./src/index.ts", "./_runtime": "./src/_runtime.ts"}
    for sub, symbols in sorted(by_sub.items()):
        write_module(sub, symbols)
        rel = sub.lstrip("/")
        if rel:
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
        "dependencies": {"@carbon/utils": "workspace:*"},
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


def write_ui_stubs(by_sub: dict[str, set[str]]) -> None:
    for rel in EE_UI_PATHS:
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        extra_key = f"__ui__:{rel}"
        extras = by_sub.get(extra_key, set())
        if rel.endswith(".ts"):
            lines = [EE_TS_FILTERS_STUB.rstrip()]
            for sym in sorted(extras):
                lines.append(emit_value(sym))
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            continue
        elif "OeeDevices" in rel:
            path.write_text(
                EE_TSX_STUB.replace(
                    "export default",
                    "export const OeeDevices = EnterpriseFeatureExcludedStub;\nexport default",
                ),
                encoding="utf-8",
            )
        else:
            path.write_text(EE_TSX_STUB, encoding="utf-8")


def patch_package_scripts() -> None:
    pkg_path = ROOT / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    pkg["scripts"]["check:workflow-catalog"] = (
        "echo 'Skipped: requires upstream packages/ee workflow catalog (excluded).'"
    )
    pkg["scripts"]["generate:workflow-catalog"] = (
        "echo 'Skipped: requires upstream packages/ee workflow catalog (excluded).'"
    )
    pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    by_sub = collect_symbols()
  # Ensure core modules exist even if only type-imported indirectly
    for sub in (
        "",
        "/plan",
        "/plan.server",
        "/workflows",
        "/workflows.server",
        "/accounting",
        "/onshape",
    ):
        by_sub.setdefault(sub, set())
    write_ee_package(by_sub)
    write_ui_stubs(by_sub)
    patch_package_scripts()
    total = sum(len(v) for v in by_sub.values())
    print(f"Generated packages/ee stubs ({len(by_sub)} modules, {total} symbols) and {len(EE_UI_PATHS)} UI .ee stubs")


if __name__ == "__main__":
    main()