# Mieszko Ordering — development report, 15 October 2026

This records the first development package. The later consolidated report is
`docs/functional-development-report.md`.

## Outcome

Implemented and locally verified the ordering, stock-import safety, dashboard,
saved-order and worker development described below. The system is **not yet
certified for live office operation**: CRM report controls, export layouts,
Windows execution and office migration approval remain external dependencies.
No Supabase was used. No office database was accessed or migrated. No deployment,
CRM session, Windows task registration or supplier communication was performed.

## Completed development

| Area | Changes |
| --- | --- |
| Forecasting | UTC weekday matching; overlapping historical days counted once; negative net returns cannot forecast stock growth; London business-date defaults and DST-safe date arithmetic. |
| Feed separation | Normal Sales, RTC Sales and Wastage remain independent tables and imports. Enabled RTC and Wastage contribute separately to demand and stock depletion, without double counting. |
| Supplier comparisons | Invalid/blank/non-finite prices and empty selections produce CHECK results rather than crashes; blank product mappings are rejected; equal-price/equal-priority ties are deterministic. |
| Order generation | Persisted Book Stock/future-delivery options; existing order headers and calculated items change atomically after calculation succeeds; failed new calculations remove their empty draft. |
| Order review | Hover/focus/click explanation includes separate feeds, forecast movement, projected stock, shortage and supplier warnings. Saved historical figures no longer change when source sales are subsequently corrected. |
| Saved orders | Dashboard links open saved orders for review, quantity edits, notes, transactional save and export. Draft saves validate item ownership and roll back all edits on failure. Quantity changes recalculate line costs. |
| Exports | Store identity in multi-store exports; supplier worksheets for positive, priced lines; case conversions without silent quantity rounding; HO exports use bounded saved daily figures, avoiding repeated all-history queries. Templates reject ambiguous multi-store filling. |
| Dashboard | Separate seven-day feed totals, store/product counts, recent orders, priced values and price-check counts. Import monitoring polls every 15 seconds while visible. |
| Manual Book Stock | Corrected PostgreSQL driver result handling for queueing/claiming/status. Partial browser chunks remain staged until complete. Whole-file imports reject partial matches and commit atomically. Latest-store stock reads do not inherit products from older snapshots. |
| Windows worker | PowerShell setup/launcher, configurable Playwright export runner, isolated per-job downloads, timeouts, strict CSV/XLSX validation, atomic import plus success audit, three-feed nightly queueing, manual-only Book Stock, deliberate stalled-job recovery and audited retry. |
| Schema and CI | Two new office migrations prepared; current fresh-database baseline replaces stale UUID schema; CI runs lint/tests/build/worker tests without deployment or migrations. |
| React maintenance | Removed effect-driven initial order defaults, fixed URL state synchronization and dependency issues, guarded stale upload-list responses. Remaining deliberate IO/storage effects have narrowly documented lint exceptions. |

## Verification

- `npm run lint`: passed, no errors or warnings.
- `npm test`: **64 tests passed across 11 files**.
- `npm run build`: passed, including Next.js compilation and TypeScript checks.
- `python -m unittest discover -s automation/tests -v`: **8 tests passed**.
- `git diff --check`: passed.

Application tests include actual SQL execution in **isolated embedded PostgreSQL**:
queue deduplication/claiming, required status transitions, stalled failure handling,
invisible partial chunks, complete stock commit, old-snapshot preservation,
unmatched/blank quantity rejection, separate movement feeds through order
generation, persisted options, saved-history stability, Excel supplier tabs,
quantity/cost updates and rollback when an item is outside the target order.

These tests do not establish real CRM selector compatibility, Windows PowerShell
execution, office database upgrade compatibility or full multi-process PostgreSQL
concurrency. No interactive browser acceptance pass against an office-connected
application was performed. GitHub CI results are separate from these local checks.

## Prepared migrations

Review against a backup of the actual office schema before approval:

1. Existing `migrations/manual/2026-10-15-data-import-runs.sql`.
2. New `migrations/manual/2026-10-15-book-stock-staging.sql`.
3. New `migrations/manual/2026-10-15-order-stock-options.sql`.
4. Existing `sql/20261014_future_delivery_expected_date.sql`, if not already applied.

`schema.sql` is for a **fresh development database only**, not an office upgrade.

## Remaining blockers and limitations

1. **Actual CRM integration:** provide/capture the authorized store report selectors,
   login environment variables, popup/frame behavior and export samples. The
   configurable runner intentionally contains no guessed CRM controls. Existing
   verified downloaders can be connected as command adapters.
2. **Report normalization:** verify each store's exact headers, sheet/header rows,
   decimal format and whether dates represent individual days. Complex grouped
   CRM exports require a normalization adapter or the existing interactive parser.
   Complete-store movement report flags default to false until verified.
3. **Office activation:** approval is required to apply migrations, install/run on
   Windows, test one store, then register the nightly scheduler. Book Stock remains
   manual. Neither migrations nor scheduling have been activated.
4. **Access boundary:** the application retains its existing trusted-office-network
   model; staff authentication/RBAC is not implemented. Public exposure is not part
   of this delivery. Local PostgreSQL must remain behind approved network controls.
5. **Operational acceptance:** exercise actual downloads/imports and representative
   orders against a backup/test office database before live use. Concurrency and
   large real-world report performance need that environment.

See `docs/office-import-activation.md` for the concrete configuration and recovery
steps. The implementation and this report are committed directly to `main`.
