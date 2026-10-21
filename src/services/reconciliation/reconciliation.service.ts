import "server-only";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db, type Database } from "@/db";
import { InputError } from "@/utils/input-error";
import type { Correction, ReviewRow } from "./workbook";

type Executor = Pick<Database, "execute">;
export type Filters = {
  storeId?: number;
  kind?: string;
  feed?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
};
export function parseFilters(params: URLSearchParams): Filters {
  const store = params.get("storeId");
  const page = Number(params.get("page") || 1);
  const from = params.get("from") || undefined,
    to = params.get("to") || undefined;
  for (const date of [from, to])
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw new InputError("Invalid report date.");
  if (from && to && from > to)
    throw new InputError("Start date must precede end date.");
  if (store && (!Number.isSafeInteger(Number(store)) || Number(store) < 1))
    throw new InputError("Invalid store.");
  return {
    storeId: store ? Number(store) : undefined,
    kind: params.get("kind") || undefined,
    feed: params.get("feed") || undefined,
    status: params.get("status") || "pending",
    search: (params.get("search") || "").slice(0, 100),
    from,
    to,
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
  };
}

// Same store lock and ordering as product approval, worker imports and queue generation.
async function lockStores(tx: Executor, ids?: number[]) {
  const rows = ids
    ? ids.map((id) => ({ id }))
    : await tx.execute(sql`SELECT id FROM stores ORDER BY id`);
  for (const row of rows)
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(73501,${Number(row.id)})`,
    );
}
async function refreshInTransaction(tx: Executor) {
  // No arbitrary job limit. Extract only product failures; parsing errors never enter this queue.
  await tx.execute(sql`WITH extracted AS (
  SELECT DISTINCT r.store_id,v.kind,btrim(j.value #>> '{}') AS identifier
  FROM data_import_runs r CROSS JOIN LATERAL (VALUES
   ('Barcode',r.details->'unmatched_barcodes'),('Product code',r.details->'unknown_product_codes')) v(kind,items)
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.items)='array' THEN v.items ELSE '[]'::jsonb END) j(value)
  WHERE (r.status='failed' OR r.details->>'has_unmatched_products'='true') AND r.store_id IS NOT NULL AND jsonb_typeof(j.value) IN ('string','number')
 ) INSERT INTO crm_product_identifiers(store_id,kind,identifier)
 SELECT store_id,kind,identifier FROM extracted WHERE length(identifier)>0
 ON CONFLICT(store_id,kind,identifier) DO NOTHING`);
  await tx.execute(sql`INSERT INTO crm_identifier_occurrences(identifier_id,run_id,transaction_count)
  SELECT DISTINCT i.id,r.id,CASE WHEN (r.details->'unmatched_transaction_counts'->>i.identifier) ~ '^[0-9]{1,9}$'
   THEN (r.details->'unmatched_transaction_counts'->>i.identifier)::int ELSE NULL END
  FROM data_import_runs r CROSS JOIN LATERAL (VALUES
   ('Barcode',r.details->'unmatched_barcodes'),('Product code',r.details->'unknown_product_codes')) v(kind,items)
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.items)='array' THEN v.items ELSE '[]'::jsonb END) j(value)
  JOIN crm_product_identifiers i ON i.store_id=r.store_id AND i.kind=v.kind AND i.identifier=btrim(j.value #>> '{}')
  WHERE (r.status='failed' OR r.details->>'has_unmatched_products'='true')
  ON CONFLICT(identifier_id,run_id) DO UPDATE SET transaction_count=EXCLUDED.transaction_count`);
  await tx.execute(sql`WITH descriptions AS (
  SELECT DISTINCT ON (i.id) i.id,r.details->'unmatched_product_descriptions'->>i.identifier AS name
  FROM crm_product_identifiers i JOIN crm_identifier_occurrences o ON o.identifier_id=i.id JOIN data_import_runs r ON r.id=o.run_id
  WHERE jsonb_typeof(r.details->'unmatched_product_descriptions'->i.identifier)='string' ORDER BY i.id,r.id DESC
 ) UPDATE crm_product_identifiers i SET product_name=d.name FROM descriptions d WHERE i.id=d.id`);
  // Native codes take precedence; conflicting aliases cannot silently override the master.
  await tx.execute(sql`WITH matches AS (
  SELECT i.id,CASE WHEN i.kind='Barcode' THEN b.store_product_id ELSE COALESCE(p.id,a.store_product_id) END AS target
  FROM crm_product_identifiers i
  LEFT JOIN product_barcodes b ON i.kind='Barcode' AND b.store_id=i.store_id AND b.barcode=i.identifier
  LEFT JOIN store_products p ON i.kind='Product code' AND p.store_id=i.store_id AND p.store_product_code=i.identifier
  LEFT JOIN crm_product_code_aliases a ON i.kind='Product code' AND a.store_id=i.store_id AND a.identifier=i.identifier
 ) UPDATE crm_product_identifiers i SET store_product_id=m.target,last_checked_at=now(),
 resolved_at=CASE WHEN m.target IS NULL THEN NULL WHEN i.store_product_id IS DISTINCT FROM m.target THEN now() ELSE COALESCE(i.resolved_at,now()) END
 FROM matches m WHERE i.id=m.id`);
  await tx.execute(sql`INSERT INTO crm_reconciliation_audit(identifier_id,store_product_id,action,operator_name)
 SELECT i.id,i.store_product_id,'MASTER_REFRESH','system' FROM crm_product_identifiers i
 WHERE i.store_product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_reconciliation_audit a WHERE a.identifier_id=i.id AND a.store_product_id=i.store_product_id)`);
  return queueResolvedReports(tx);
}
async function queueResolvedReports(tx: Executor) {
  // Only the newest failure in an overlapping range can be replayed. A mapping signature
  // carried into the child prevents an outdated worker retrying forever after refresh.
  const eligible =
    await tx.execute(sql`SELECT r.*,bool_or(i.store_product_id IS NOT NULL) AS has_resolved_identifiers,md5(string_agg(i.id::text||':'||COALESCE(i.store_product_id::text,'pending'),',' ORDER BY i.id)) AS signature
 FROM data_import_runs r JOIN crm_identifier_occurrences o ON o.run_id=r.id
 JOIN crm_product_identifiers i ON i.id=o.identifier_id
 JOIN stores s ON s.id=r.store_id AND s.is_active
 WHERE (r.status='failed' OR r.details->>'has_unmatched_products'='true') AND r.source_type IN ('normal_sales','rtc','wastage')
 AND r.source_start_date IS NOT NULL AND r.source_end_date IS NOT NULL
 AND NOT (r.details ? 'queue_control') AND NOT(r.details ? 'reconciliation_retry_id')
 AND NOT EXISTS(SELECT 1 FROM data_import_runs n WHERE n.store_id=r.store_id AND n.source_type=r.source_type
  AND n.source_start_date<=r.source_end_date AND n.source_end_date>=r.source_start_date
  AND (n.status IN ('queued','downloading','downloaded','importing') OR n.id>r.id))
 GROUP BY r.id HAVING bool_or(i.store_product_id IS NOT NULL) OR jsonb_typeof(r.details->'staged_row_count')='number'`);
  let queued = 0;
  for (const run of eligible) {
    const details = run.details as Record<string, unknown>;
    if (details.reconciliation_signature === run.signature) continue;
    // A current worker has already published every known row. Retry only when
    // at least one of this attempt's remaining unknown identifiers now resolves.
    if(details.partial_import_version===1 && !run.has_resolved_identifiers)continue;
    const [next] =
      await tx.execute(sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,source_start_date,source_end_date,details)
   VALUES(${run.store_id},${run.source_type},'retry',${run.source_start_date},${run.source_end_date},
    jsonb_build_object('retry_of',${String(run.id)}::bigint,'reconciliation_signature',${String(run.signature)}::text,'reuse_validated_stage',true)) RETURNING id`);
    await tx.execute(
      sql`UPDATE data_import_runs SET details=details||jsonb_build_object('reconciliation_retry_id',${String(next.id)}::bigint) WHERE id=${run.id}`,
    );
    queued++;
  }
  return { queued, checkedAt: new Date().toISOString() };
}
export async function refreshReconciliation() {
  return db.transaction(async (tx) => {
    await lockStores(tx);
    return refreshInTransaction(tx);
  });
}

function whereFilters(f: Filters): SQL {
  return sql`(${f.storeId ?? null}::int IS NULL OR i.store_id=${f.storeId ?? null})
 AND (${f.kind ?? null}::text IS NULL OR i.kind=${f.kind ?? null})
 AND (${f.search || null}::text IS NULL OR strpos(lower(i.identifier||' '||COALESCE(i.product_name,'')),lower(${f.search || null}::text))>0)
 AND (${f.status ?? "pending"}='all' OR (${f.status ?? "pending"}='resolved' AND i.store_product_id IS NOT NULL) OR (${f.status ?? "pending"}='pending' AND i.store_product_id IS NULL))
 AND EXISTS(SELECT 1 FROM crm_identifier_occurrences o JOIN data_import_runs r ON r.id=o.run_id
  WHERE o.identifier_id=i.id AND (${f.feed ?? null}::text IS NULL OR r.source_type=${f.feed ?? null})
  AND (${f.from ?? null}::date IS NULL OR r.source_end_date>=${f.from ?? null}::date)
  AND (${f.to ?? null}::date IS NULL OR r.source_start_date<=${f.to ?? null}::date))`;
}
export async function listIdentifiers(f: Filters, all = false) {
  const where = whereFilters(f);
  const [items, count, stores, checked] = await Promise.all([
    db.execute(sql`SELECT i.id::text,i.store_id AS "storeId",s.name AS store,i.kind,i.identifier,
   COALESCE(p.name,i.product_name,'') AS "productName",p.department,
   CASE WHEN i.store_product_id IS NULL THEN 'pending' ELSE 'resolved' END AS status,
   i.last_checked_at AS "lastCheckedAt",sp.store_product_code AS "existingCode",
   string_agg(DISTINCT r.id::text,', ') AS jobs,string_agg(DISTINCT r.source_start_date::text,', ') AS dates,
   string_agg(DISTINCT r.source_type,', ') AS feeds,
   CASE WHEN count(o.transaction_count)=count(*) THEN sum(o.transaction_count)::int ELSE NULL END AS "transactionCount"
   FROM crm_product_identifiers i JOIN stores s ON s.id=i.store_id
   LEFT JOIN store_products sp ON sp.id=i.store_product_id LEFT JOIN products p ON p.id=sp.product_id
   JOIN crm_identifier_occurrences o ON o.identifier_id=i.id JOIN data_import_runs r ON r.id=o.run_id
   WHERE ${where} GROUP BY i.id,s.name,p.name,p.department,sp.store_product_code
   ORDER BY i.store_id,i.identifier,i.id ${all ? sql`` : sql`LIMIT 50 OFFSET ${((f.page ?? 1) - 1) * 50}`}`),
    db.execute(
      sql`SELECT count(*)::int AS total FROM crm_product_identifiers i WHERE ${where}`,
    ),
    db.execute(sql`SELECT id,name FROM stores ORDER BY name`),
    db.execute(
      sql`SELECT max(last_checked_at) AS time FROM crm_product_identifiers`,
    ),
  ]);
  return {
    items,
    total: Number(count[0].total),
    stores,
    checkedAt: checked[0].time,
    page: f.page ?? 1,
    pageSize: 50,
  };
}

async function validateRows(
  tx: Executor,
  rows: Correction[],
): Promise<ReviewRow[]> {
  const storeIds = [
    ...new Set(rows.map((r) => r.storeId).filter(Number.isSafeInteger)),
  ];
  const identities = storeIds.length
    ? await tx.execute(
        sql`SELECT * FROM crm_product_identifiers WHERE store_id IN (${sql.join(
          storeIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      )
    : [];
  const products = storeIds.length
    ? await tx.execute(
        sql`SELECT id,store_id,store_product_code FROM store_products WHERE store_id IN (${sql.join(
          storeIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      )
    : [];
  const barcodes = storeIds.length
    ? await tx.execute(
        sql`SELECT * FROM product_barcodes WHERE store_id IN (${sql.join(
          storeIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      )
    : [];
  const aliases = storeIds.length
    ? await tx.execute(
        sql`SELECT * FROM crm_product_code_aliases WHERE store_id IN (${sql.join(
          storeIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      )
    : [];
  const identityMap = new Map(
    identities.map((i) => [
      JSON.stringify([Number(i.store_id), i.kind, i.identifier]),
      i,
    ]),
  );
  const productMap = new Map(
    products.map((p) => [
      JSON.stringify([Number(p.store_id), p.store_product_code]),
      Number(p.id),
    ]),
  );
  const barcodeMap = new Map(
    barcodes.map((b) => [
      JSON.stringify([Number(b.store_id), b.barcode]),
      Number(b.store_product_id),
    ]),
  );
  const aliasMap = new Map(
    aliases.map((a) => [
      JSON.stringify([Number(a.store_id), a.identifier]),
      Number(a.store_product_id),
    ]),
  );
  const duplicates = new Map<string, ReviewRow>();
  const newCodes = new Map<string, ReviewRow>();
  const claimedBarcodes = new Map<string, ReviewRow>();
  const result: ReviewRow[] = [];
  for (const row of rows) {
    const item: ReviewRow = {
      ...row,
      errors: [],
      warnings: [],
      targetId: null,
      identifierId: null,
    };
    result.push(item);
    if (!row.action) {
      item.warnings.push("No action: remains pending.");
      continue;
    }
    const key = JSON.stringify([row.storeId, row.kind, row.identifier]);
    const identity = identityMap.get(key);
    if (!identity)
      item.errors.push(
        "Identifier is not in the review queue for this store. Refresh and export again.",
      );
    else item.identifierId = Number(identity.id);
    const previous = duplicates.get(key);
    if (previous) {
      item.errors.push("Duplicate identifier in workbook.");
      previous.errors.push("Duplicate identifier in workbook.");
    } else duplicates.set(key, item);
    if (!["MATCH_EXISTING", "ADD_NEW"].includes(row.action))
      item.errors.push("Action must be MATCH_EXISTING or ADD_NEW.");
    if (
      row.identifier.length > 100 ||
      !row.identifier ||
      !["Barcode", "Product code"].includes(row.kind)
    )
      item.errors.push("Invalid CRM identity.");
    for (const [label, value, max] of [
      ["Product Name", row.productName, 500],
      ["Department", row.department, 100],
      ["Barcode", row.barcode, 100],
      ["Existing Product Code", row.existingCode, 100],
      ["New Product Code", row.newCode, 100],
      ["Review Notes", row.notes, 4000],
      ["Supplier Code", row.supplierCode, 100],
    ] as const)
      if (value.length > max)
        item.errors.push(`${label} exceeds ${max} characters.`);
    const code =
      row.action === "MATCH_EXISTING" ? row.existingCode : row.newCode;
    const codeKey = JSON.stringify([row.storeId, code]);
    item.targetId = productMap.get(codeKey) ?? null;
    if (row.action === "MATCH_EXISTING" && !item.targetId)
      item.errors.push("Existing product code was not found in this store.");
    if (row.action === "ADD_NEW") {
      const claimed = aliasMap.get(codeKey);
      if (claimed && claimed !== item.targetId)
        item.errors.push("New Product Code is already an approved CRM alias.");
      if (!code || !row.productName || !row.department)
        item.errors.push(
          "ADD_NEW requires New Product Code, Product Name and Department.",
        );
      if (row.kind === "Product code" && code !== row.identifier)
        item.errors.push(
          "New Product Code must equal the original CRM product code.",
        );
      if (item.targetId && Number(identity?.store_product_id) !== item.targetId)
        item.errors.push("Product code already exists: choose MATCH_EXISTING.");
      if (item.targetId)
        item.warnings.push("Already applied: no new product will be created.");
      const prev = newCodes.get(codeKey);
      if (prev) {
        item.errors.push("Duplicate new product code.");
        prev.errors.push("Duplicate new product code.");
      } else newCodes.set(codeKey, item);
    }
    const native =
      row.kind === "Product code"
        ? productMap.get(JSON.stringify([row.storeId, row.identifier]))
        : barcodeMap.get(JSON.stringify([row.storeId, row.identifier]));
    const alias =
      row.kind === "Product code"
        ? aliasMap.get(JSON.stringify([row.storeId, row.identifier]))
        : undefined;
    for (const mapped of [native, alias])
      if (mapped && mapped !== item.targetId)
        item.errors.push(
          "Identifier is already mapped to a different product.",
        );
    const codes = [
      ...new Set(
        [
          row.barcode,
          ...(row.kind === "Barcode" ? [row.identifier] : []),
        ].filter(Boolean),
      ),
    ];
    for (const barcode of codes) {
      const barcodeKey = JSON.stringify([row.storeId, barcode]);
      const existing = barcodeMap.get(barcodeKey);
      if (existing && existing !== item.targetId)
        item.errors.push(`Barcode ${barcode} belongs to another product.`);
      const prev = claimedBarcodes.get(barcodeKey);
      if (prev && (!item.targetId || prev.targetId !== item.targetId)) {
        item.errors.push("Conflicting barcode in workbook.");
        prev.errors.push("Conflicting barcode in workbook.");
      } else claimedBarcodes.set(barcodeKey, item);
    }
    if (row.supplierCode)
      item.warnings.push(
        "Supplier Code will be saved in audit notes; no supplier link is guessed.",
      );
  }
  return result;
}
function summary(rows: ReviewRow[]) {
  return {
    total: rows.length,
    changes: rows.filter((r) => r.action && !r.errors.length).length,
    pending: rows.filter((r) => !r.action).length,
    errors: rows.filter((r) => r.errors.length).length,
  };
}
export async function previewCorrections(rows: Correction[]) {
  return db.transaction(async (tx) => {
    const reviewed = await validateRows(tx, rows);
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO crm_reconciliation_batches(id,rows) VALUES(${id},${JSON.stringify(rows)}::jsonb)`,
    );
    return {
      id,
      rows: reviewed.slice(0, 50),
      summary: summary(reviewed),
      page: 1,
    };
  });
}
export async function approveCorrections(batchId: string, operator: string) {
  if (!/^[0-9a-f-]{36}$/i.test(batchId))
    throw new InputError("Invalid preview.");
  if (!operator.trim() || operator.length > 100)
    throw new InputError("Enter your operator name (maximum 100 characters).");
  return db.transaction(async (tx) => {
    await lockStores(tx);
    const [batch] = await tx.execute(
      sql`SELECT * FROM crm_reconciliation_batches WHERE id=${batchId} FOR UPDATE`,
    );
    if (!batch) throw new InputError("Preview not found.");
    if (batch.approved_at) return batch.result;
    if (Date.now() - new Date(String(batch.created_at)).getTime() > 86400000)
      throw new InputError("Preview expired. Upload again.");
    const rows = await validateRows(tx, batch.rows as Correction[]);
    if (rows.some((row) => row.errors.length))
      throw new InputError(
        "Validation failed or product data changed. Upload again and review the row errors. No changes were applied.",
      );
    let applied = 0;
    for (const row of rows) {
      if (!row.action) continue;
      let target = row.targetId;
      if (!target) {
        const [product] = await tx.execute(
          sql`INSERT INTO products(name,department,order_department_id) VALUES(${row.productName},${row.department},(SELECT id FROM departments WHERE name=${row.department} LIMIT 1)) RETURNING id`,
        );
        const [sp] = await tx.execute(
          sql`INSERT INTO store_products(store_id,product_id,store_product_code) VALUES(${row.storeId},${product.id},${row.newCode}) RETURNING id`,
        );
        target = Number(sp.id);
      }
      if (
        row.kind === "Product code" &&
        row.identifier !==
          (row.action === "ADD_NEW" ? row.newCode : row.existingCode)
      ) {
        await tx.execute(
          sql`INSERT INTO crm_product_code_aliases(store_id,identifier,store_product_id) VALUES(${row.storeId},${row.identifier},${target}) ON CONFLICT(store_id,identifier) DO NOTHING`,
        );
      }
      for (const barcode of new Set(
        [
          row.barcode,
          ...(row.kind === "Barcode" ? [row.identifier] : []),
        ].filter(Boolean),
      )) {
        // Never overwrite a competing mapping. A race produces a transaction rollback.
        const [existing] = await tx.execute(
          sql`SELECT store_product_id FROM product_barcodes WHERE store_id=${row.storeId} AND barcode=${barcode}`,
        );
        if (existing && Number(existing.store_product_id) !== target)
          throw new InputError("A barcode mapping changed. Upload again.");
        if (!existing)
          await tx.execute(
            sql`INSERT INTO product_barcodes(store_id,store_product_id,barcode) VALUES(${row.storeId},${target},${barcode})`,
          );
      }
      await tx.execute(
        sql`UPDATE crm_product_identifiers SET store_product_id=${target},resolved_at=COALESCE(resolved_at,now()),last_checked_at=now() WHERE id=${row.identifierId}`,
      );
      await tx.execute(sql`INSERT INTO crm_reconciliation_audit(identifier_id,batch_id,store_product_id,action,operator_name,notes,supplier_code)
    VALUES(${row.identifierId},${batchId},${target},${row.action},${operator.trim()},${row.notes},${row.supplierCode})`);
      applied++;
    }
    const refreshed = await refreshInTransaction(tx);
    const result = { applied, ...refreshed };
    await tx.execute(
      sql`UPDATE crm_reconciliation_batches SET approved_at=now(),approved_by=${operator.trim()},result=${JSON.stringify(result)}::jsonb WHERE id=${batchId}`,
    );
    return result;
  });
}
export async function auditHistory(identifierId: string) {
  if (!/^\d+$/.test(identifierId)) throw new InputError("Invalid identifier.");
  return db.execute(sql`SELECT a.id::text,a.action,a.operator_name AS "operatorName",a.notes,a.supplier_code AS "supplierCode",a.created_at AS "createdAt",p.store_product_code AS "productCode"
  FROM crm_reconciliation_audit a LEFT JOIN store_products p ON p.id=a.store_product_id WHERE identifier_id=${identifierId}::bigint ORDER BY a.id DESC LIMIT 100`);
}

export async function getPreview(id: string, page = 1) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new InputError("Invalid preview.");
  const [batch] = await db.execute(
    sql`SELECT rows FROM crm_reconciliation_batches WHERE id=${id}`,
  );
  if (!batch) throw new InputError("Preview not found.");
  const rows = await validateRows(db, batch.rows as Correction[]);
  return {
    id,
    rows: rows.slice((page - 1) * 50, page * 50),
    summary: summary(rows),
    page,
  };
}

// Product import has already saved its rows: a reconciliation failure must never
// report that the product import itself rolled back. Surface a distinct warning.
export async function reconcileAfterProductSave() {
  try {
    return await refreshReconciliation();
  } catch (error) {
    console.error(
      "Product save succeeded; reconciliation refresh failed",
      error,
    );
    return {
      queued: 0,
      warning:
        "Products were saved. Automatic reconciliation failed; open Unmatched Products and Refresh.",
    };
  }
}

export async function validatedWorkbookRows(
  id: string,
): Promise<
  (ReviewRow & Record<string, unknown> & { validationStatus: string })[]
> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new InputError("Invalid preview.");
  const [batch] = await db.execute(
    sql`SELECT rows FROM crm_reconciliation_batches WHERE id=${id}`,
  );
  if (!batch) throw new InputError("Preview not found.");
  const rows = await validateRows(db, batch.rows as Correction[]);
  const listing = await listIdentifiers({ status: "all" }, true);
  const originals = new Map(
    listing.items.map((item) => [
      JSON.stringify([Number(item.storeId), item.kind, item.identifier]),
      item,
    ]),
  );
  return rows.map((row) => ({
    ...originals.get(JSON.stringify([row.storeId, row.kind, row.identifier])),
    ...row,
    validationStatus: row.errors.length
      ? "ERROR: " + row.errors.join(" ")
      : row.action
        ? "VALID" + (row.warnings.length ? ": " + row.warnings.join(" ") : "")
        : "PENDING",
  }));
}
