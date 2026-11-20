// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { CreatableCombobox, Combobox } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Input,
  VStack
} from "@carbon/react";
import { sumPercentWw } from "@skuu/formula";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigate
} from "react-router";
import CustomerAvatar from "~/components/CustomerAvatar";
import {
  type SkuuProductWizardDraft,
  skuuProductWizardDraftSchema,
  WIZARD_DRAFT_STORAGE_KEY,
  wizardFormulaCheck
} from "~/modules/skuu/skuu-product-wizard.models";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";
import type { loader, action } from "./new-product";

const STEPS = [
  "Client & product",
  "Formula",
  "Method",
  "Bulk settings",
  "Pack sizes",
  "Packaging",
  "Review"
] as const;

const emptyDraft = (): SkuuProductWizardDraft => ({
  customerId: "",
  productName: "",
  clientSkuRef: "",
  formulaRef: "",
  ingredients: [
    {
      partCode: "",
      tradeName: "",
      percentWw: 0,
      phaseNumber: 1
    }
  ],
  phases: [{ phaseNumber: 1, instructions: "" }],
  productDensityGPerMl: 1,
  expectedYieldPercent: 98,
  standardBatchKg: 100,
  fills: [{ packSizeMl: 50 }],
  packaging: []
});

function loadDraft(): SkuuProductWizardDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = localStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft();
    return skuuProductWizardDraftSchema.parse(JSON.parse(raw));
  } catch {
    return emptyDraft();
  }
}

export default function SkuuNewProductWizard() {
  const { t } = useLingui();
  const { initialStep } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const searchFetcher = useFetcher<typeof action>();
  const [customers] = useCustomers();
  const [step, setStep] = useState(initialStep);
  const [draft, setDraft] = useState<SkuuProductWizardDraft>(() => loadDraft());

  useEffect(() => {
    localStorage.setItem(WIZARD_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: <CustomerAvatar customerId={c.id} />,
        keywords: c.name
      })),
    [customers]
  );

  const formulaCheck = useMemo(() => wizardFormulaCheck(draft), [draft]);
  const percentTotal = sumPercentWw(
    draft.ingredients.map((line, i) => ({
      id: String(i),
      percentWw: line.percentWw
    }))
  );

  const materialOptions = useMemo(() => {
    const mats =
      searchFetcher.data &&
      typeof searchFetcher.data === "object" &&
      searchFetcher.data !== null &&
      "materials" in searchFetcher.data &&
      Array.isArray((searchFetcher.data as { materials: unknown }).materials)
        ? (searchFetcher.data as {
            materials: Array<{
              readableId: string | null;
              name: string | null;
            }>;
          }).materials
        : [];
    return mats.map((m) => ({
      label: `${m.readableId ?? "?"} — ${m.name ?? ""}`,
      value: `${m.readableId ?? ""}|${m.name ?? ""}`,
      keywords: `${m.readableId} ${m.name}`
    }));
  }, [searchFetcher.data]);

  const goStep = (n: number) => {
    setStep(n);
    navigate(`${path.to.skuuNewProduct}?step=${n}`, { replace: true });
  };

  return (
    <VStack className="gap-6 p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">
        <Trans>New product (SkuuOS)</Trans>
      </h1>
      <HStack className="gap-2 flex-wrap text-sm">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`px-2 py-1 rounded ${step === i + 1 ? "bg-muted font-medium" : "text-muted-foreground"}`}
            onClick={() => goStep(i + 1)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </HStack>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="text-destructive text-sm">{String(actionData.error)}</p>
      ) : null}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Client & product</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CreatableCombobox
              label={t`Client`}
              options={customerOptions}
              value={draft.customerId}
              onChange={(id) =>
                setDraft((d) => ({ ...d, customerId: id ?? "" }))
              }
              placeholder={t`Search customers`}
            />
            <Input
              label={t`Product name`}
              value={draft.productName}
              onChange={(e) =>
                setDraft((d) => ({ ...d, productName: e.target.value }))
              }
            />
            <Input
              label={t`Client SKU / formula ref`}
              value={draft.clientSkuRef}
              onChange={(e) => {
                const v = e.target.value;
                setDraft((d) => ({
                  ...d,
                  clientSkuRef: v,
                  formulaRef: v.replace(/[^a-zA-Z0-9-_]/g, "-").toUpperCase()
                }));
              }}
            />
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Formula (% w/w)</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">
              <Trans>Total {percentTotal.toFixed(2)}%</Trans>
              {formulaCheck.ok ? " ✓" : ` — ${formulaCheck.message ?? ""}`}
            </p>
            {draft.ingredients.map((line, idx) => (
              <IngredientEditor
                key={idx}
                idx={idx}
                line={line}
                materialOptions={materialOptions}
                onSearch={(q) => {
                  const fd = new FormData();
                  fd.set("intent", "searchMaterials");
                  fd.set("q", q);
                  searchFetcher.submit(fd, { method: "post" });
                }}
                onChange={(next) =>
                  setDraft((d) => {
                    const ingredients = [...d.ingredients];
                    ingredients[idx] = next;
                    return { ...d, ingredients };
                  })
                }
              />
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  ingredients: [
                    ...d.ingredients,
                    {
                      partCode: "",
                      tradeName: "",
                      percentWw: 0,
                      phaseNumber: 1
                    }
                  ]
                }))
              }
            >
              <Trans>Add ingredient line</Trans>
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Method of manufacture</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {draft.phases.map((phase, idx) => (
              <PhaseEditor
                key={phase.phaseNumber}
                phase={phase}
                draft={draft}
                onChange={(p) =>
                  setDraft((d) => {
                    const phases = [...d.phases];
                    phases[idx] = p;
                    return { ...d, phases };
                  })
                }
              />
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  phases: [
                    ...d.phases,
                    {
                      phaseNumber:
                        Math.max(0, ...d.phases.map((p) => p.phaseNumber)) + 1,
                      instructions: ""
                    }
                  ]
                }))
              }
            >
              <Trans>Add phase</Trans>
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Bulk settings</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Input
              label={t`Density (g/mL)`}
              type="number"
              value={String(draft.productDensityGPerMl ?? "")}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  productDensityGPerMl: Number(e.target.value)
                }))
              }
            />
            <Input
              label={t`Expected yield %`}
              type="number"
              value={String(draft.expectedYieldPercent)}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  expectedYieldPercent: Number(e.target.value)
                }))
              }
            />
            <Input
              label={t`Standard batch size (kg)`}
              type="number"
              value={String(draft.standardBatchKg)}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  standardBatchKg: Number(e.target.value)
                }))
              }
            />
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Pack sizes</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {draft.fills.map((fill, idx) => (
              <Input
                key={idx}
                label={t`Pack size (mL)`}
                type="number"
                value={String(fill.packSizeMl)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDraft((d) => {
                    const fills = [...d.fills];
                    fills[idx] = { ...fills[idx]!, packSizeMl: v };
                    return { ...d, fills };
                  });
                }}
              />
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  fills: [...d.fills, { packSizeMl: 100 }]
                }))
              }
            >
              <Trans>Add pack size</Trans>
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 6 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Packaging</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Trans>
              Add bottles, pumps, labels and cartons on each finished good Product
              build screen after create.
            </Trans>
          </CardContent>
        </Card>
      )}

      {step === 7 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Review & create</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              <strong>{draft.productName}</strong> · BULK-{draft.formulaRef}
            </p>
            <ul className="list-disc pl-5">
              {draft.ingredients.map((l, i) => (
                <li key={i}>
                  {l.partCode} — {l.tradeName}: {l.percentWw}% (phase{" "}
                  {l.phaseNumber})
                </li>
              ))}
            </ul>
            {draft.fills.map((f, i) => (
              <p key={i}>
                FG-{draft.formulaRef}-{f.packSizeMl}ML
              </p>
            ))}
            <Form method="post">
              <input type="hidden" name="intent" value="create" />
              <input type="hidden" name="draft" value={JSON.stringify(draft)} />
              <Button type="submit" disabled={!formulaCheck.ok}>
                <Trans>Create product</Trans>
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}

      <HStack className="gap-2 justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={step <= 1}
          onClick={() => goStep(step - 1)}
        >
          <Trans>Back</Trans>
        </Button>
        {step < 7 ? (
          <Button type="button" onClick={() => goStep(step + 1)}>
            <Trans>Next</Trans>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
            setDraft(emptyDraft());
          }}
        >
          <Trans>Clear draft</Trans>
        </Button>
      </HStack>
    </VStack>
  );
}

function IngredientEditor({
  idx: _idx,
  line,
  materialOptions,
  onSearch,
  onChange
}: {
  idx: number;
  line: SkuuProductWizardDraft["ingredients"][number];
  materialOptions: Array<{ label: string; value: string; keywords: string }>;
  onSearch: (q: string) => void;
  onChange: (line: SkuuProductWizardDraft["ingredients"][number]) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="border rounded-md p-3 flex flex-col gap-2">
      <HStack className="gap-2">
        <Input
          label={t`Search materials`}
          onChange={(e) => onSearch(e.target.value)}
        />
        <Combobox
          label={t`Pick existing`}
          options={materialOptions}
          value=""
          onChange={(val) => {
            if (!val) return;
            const [code, name] = val.split("|");
            onChange({
              ...line,
              partCode: code ?? "",
              tradeName: name ?? ""
            });
          }}
        />
      </HStack>
      <HStack className="gap-2">
        <Input
          label={t`Material code`}
          value={line.partCode}
          onChange={(e) => onChange({ ...line, partCode: e.target.value })}
        />
        <Input
          label={t`Trade name`}
          value={line.tradeName}
          onChange={(e) => onChange({ ...line, tradeName: e.target.value })}
        />
      </HStack>
      <HStack className="gap-2">
        <Input
          label={t`% w/w`}
          type="number"
          value={String(line.percentWw)}
          onChange={(e) =>
            onChange({ ...line, percentWw: Number(e.target.value) })
          }
        />
        <Input
          label={t`Phase`}
          type="number"
          value={String(line.phaseNumber)}
          onChange={(e) =>
            onChange({ ...line, phaseNumber: Number(e.target.value) })
          }
        />
      </HStack>
    </div>
  );
}

function PhaseEditor({
  phase,
  draft,
  onChange
}: {
  phase: SkuuProductWizardDraft["phases"][number];
  draft: SkuuProductWizardDraft;
  onChange: (p: SkuuProductWizardDraft["phases"][number]) => void;
}) {
  const { t } = useLingui();
  const lines = draft.ingredients.filter(
    (l) => l.phaseNumber === phase.phaseNumber
  );
  return (
    <div className="border rounded-md p-3 flex flex-col gap-2">
      <strong>
        <Trans>Phase {phase.phaseNumber}</Trans>
      </strong>
      <ul className="text-xs text-muted-foreground list-disc pl-4">
        {lines.map((l, i) => (
          <li key={i}>
            {l.partCode} · {l.tradeName} · {l.percentWw}% w/w
          </li>
        ))}
      </ul>
      <textarea
        className="border rounded p-2 text-sm min-h-[80px]"
        value={phase.instructions}
        placeholder={t`Precautions, planning, protocol, past experience…`}
        onChange={(e) => onChange({ ...phase, instructions: e.target.value })}
      />
    </div>
  );
}