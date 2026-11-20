-- SkuuOS: read-only Postgres role for the MCP server (SELECT-only, default_transaction_read_only).

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skuuos_mcp_readonly') THEN
    CREATE ROLE skuuos_mcp_readonly NOLOGIN;
  END IF;
END
$do$;

ALTER ROLE skuuos_mcp_readonly SET default_transaction_read_only = on;

GRANT USAGE ON SCHEMA public TO skuuos_mcp_readonly;

GRANT SELECT ON TABLE
  "company",
  "companySettings",
  "currency",
  "customer",
  "item",
  "part",
  "material",
  "consumable",
  "itemCost",
  "itemUnitSalePrice",
  "itemLedger",
  "itemUnitOfMeasure",
  "location",
  "storageUnit",
  "supplierPart",
  "supplierPartPrice",
  "makeMethod",
  "methodMaterial",
  "skuuMakeMethodBulk",
  "skuuMethodMaterialFormula",
  "skuuItemRetest",
  "trackedEntity",
  "trackedActivity",
  "trackedActivityInput",
  "trackedActivityOutput",
  "job",
  "jobMaterial",
  "jobMakeMethod",
  "jobOperation",
  "quote",
  "quoteLine",
  "quoteLinePrice",
  "quoteMaterial",
  "quoteOperation",
  "quoteMakeMethod",
  "purchaseOrder",
  "purchaseOrderLine",
  "purchaseOrderDelivery",
  "salesOrder",
  "salesOrderLine",
  "salesOrderDelivery",
  "receipt",
  "receiptLine",
  "shipment",
  "shipmentLine",
  "unitOfMeasure",
  "customerItemPriceOverrideBreak",
  "pricingRule"
TO skuuos_mcp_readonly;

GRANT EXECUTE ON FUNCTION get_quote_methods_by_method_id(text) TO skuuos_mcp_readonly;
GRANT EXECUTE ON FUNCTION get_exchange_rates(text) TO skuuos_mcp_readonly;

COMMENT ON ROLE skuuos_mcp_readonly IS
  'SkuuOS MCP read-only group. Grant to a LOGIN role; set SKUUOS_MCP_DATABASE_URL to that login.';