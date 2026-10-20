import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const connection = 'postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql = postgres(connection, { max: 1, prepare: false, onnotice: () => {} });
test.beforeEach(async () => { await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql', 'utf8')); });
test.afterAll(async () => { await sql.end(); });
async function failed(day = '2026-10-14', error = 'CRM report export failed.', details = {}, store = 1, source = 'normal_sales') {
 const [row] = await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,error_message,details,completed_at) VALUES(${store},${source},'manual','failed',${day},${day},${error},${sql.json(details)},now()-interval '2 hours') RETURNING id`;
 return Number(row.id);
}
function recover(revision = 'release-one', stores = [1], sources = ['normal_sales', 'rtc', 'wastage']) {
 const code = `import os,json,psycopg\nfrom automation.worker import enqueue_failed_retries\nwith psycopg.connect(os.environ['DATABASE_URL'],autocommit=True,prepare_threshold=None) as conn:\n print(json.dumps(enqueue_failed_retries(conn,${JSON.stringify(stores)},${JSON.stringify(sources)},'2026-10-19',${JSON.stringify(revision)})))`;
 return JSON.parse(execFileSync('python', ['-c', code], { env: { ...process.env, DATABASE_URL: connection }, encoding: 'utf8', timeout: 15000 })) as number[];
}

test('nightly recovery retries cooled transient failures exactly three times and preserves audit', async ({ page, request }) => {
 const original = await failed();
 let parent = original;
 for (let count = 1; count <= 3; count++) {
  const ids = recover(); expect(ids).toHaveLength(1);
  const [child] = await sql`SELECT * FROM data_import_runs WHERE id=${ids[0]}`;
  expect(child.details).toMatchObject({ retry_of: parent, automatic_retry_count: count, automatic_retry_reason: 'download_retry' });
  expect(recover()).toEqual([]);
  if (count === 1) {
   await page.goto('/downloads');
   await page.getByRole('button', { name: /^Waiting \(/ }).click();
   await expect(page.getByText('Automatic retry 1/3', { exact: true })).toBeVisible();
   const response = await request.get('/api/data-operations/diagnostics');
   expect(response.ok()).toBe(true);
   expect((await response.json()).runs.find((run: { id: string }) => Number(run.id) === ids[0]).automatic_retry_count).toBe(1);
  }
  await sql`UPDATE data_import_runs SET status='failed',error_message='TimeoutExpired',completed_at=now()-interval '2 hours' WHERE id=${ids[0]}`;
  parent = ids[0];
 }
 expect(recover()).toEqual([]);
 expect(await sql`SELECT id FROM data_import_runs WHERE status='failed'`).toHaveLength(4);
 expect(Number((await sql`SELECT details->>'automatic_retry_as' AS next FROM data_import_runs WHERE id=${original}`)[0].next)).toBeGreaterThan(original);
});

test('nightly recovery honours cooldown, paused/cancelled work, newer success and active attempts', async () => {
 const recent = await failed('2026-10-13');
 await sql`UPDATE data_import_runs SET completed_at=now() WHERE id=${recent}`;
 await failed('2026-10-14', 'Worker stopped or timed out', { queue_control: 'paused' });
 await failed('2026-10-15', 'Worker stopped or timed out', { queue_control: 'cancelled' });
 const superseded = await failed('2026-10-16');
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date) SELECT store_id,source_type,'retry','success',source_start_date,source_end_date FROM data_import_runs WHERE id=${superseded}`;
 const busy = await failed('2026-10-17');
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date) SELECT store_id,source_type,'retry','queued',source_start_date,source_end_date FROM data_import_runs WHERE id=${busy}`;
 expect(recover()).toEqual([]);
});

test('nightly recovery skips product review, validation errors and unchanged parser versions', async () => {
 await failed('2026-10-10', 'Unmatched product identifiers', { partial_import: true });
 await failed('2026-10-11', 'Report downloader failed', { unknown_product_codes: ['X'] });
 await failed('2026-10-12', 'Report parsing failed: Report date differs from requested date');
 await failed('2026-10-13', 'Report parsing failed: MSP Wastage report says No Records Available.');
 await failed('2026-10-14', 'CRM displayed another or missing store code.');
 await failed('2026-10-15', 'Report parsing failed: Report columns not detected', { worker_revision: 'release-one' });
 expect(recover()).toEqual([]);
});

test('nightly recovery retries a parser failure once per changed worker version within its budget', async () => {
 await failed('2026-10-14', 'Report parsing failed: Report columns not detected');
 const [id] = recover(); expect(id).toBeGreaterThan(0);
 await sql`UPDATE data_import_runs SET status='failed',completed_at=now()-interval '2 hours',error_message='Report parsing failed',details=details||'{"worker_revision":"release-one"}'::jsonb WHERE id=${id}`;
 expect(recover()).toEqual([]);
 expect(recover('release-two')).toHaveLength(1);
});

test('nightly recovery limits dates, stores and enabled feeds and rejects invalid retry metadata', async () => {
 await failed('2026-09-19'); // older than the last 30 completed report days
 await failed('2026-10-20'); // unfinished day
 await failed('2026-10-14', 'ConnectionError', {}, 2);
 await failed('2026-10-15', 'ConnectionError', {}, 1, 'rtc');
 for (const [offset, value] of [3, -1, '1', true].entries()) {
  await failed(`2026-10-${10 + offset}`, 'ConnectionError', { automatic_retry_count: value });
 }
 expect(recover('release-one', [1], ['normal_sales'])).toEqual([]);
 await sql`UPDATE stores SET is_active=false WHERE id=2`;
 expect(recover('release-one', [2])).toEqual([]);
 const boundary = await failed('2026-09-20');
 const [id] = recover('release-one', [1], ['normal_sales']);
 expect((await sql`SELECT details FROM data_import_runs WHERE id=${id}`)[0].details.retry_of).toBe(boundary);
});

test('a recovered CRM download imports once and subsequent schedules cannot duplicate totals', async () => {
 const original = await failed();
 const [id] = recover();
 const folder = mkdtempSync(path.join(tmpdir(), 'mieszko-recovery-'));
 const config = path.join(folder, 'config.json');
 writeFileSync(config, JSON.stringify({ download_directory: path.join(folder, 'downloads'), app_directory: process.cwd(), stores: { '1': { erp: 'msp', feeds: { normal_sales: { extension: '.xlsx', mapping: { code: 'Item Code', quantity: 'Quantity' }, complete_store_report: true, normalize_with_app_parsers: true, command: ['python', 'tests/support/fixture-crm.py', '--output', '{output}', '--source', '{source}', '--start', '{start}', '--store', '{store_id}'] } } } } }));
 execFileSync('python', ['automation/worker.py', '--config', config, '--once'], { env: { ...process.env, DATABASE_URL: connection }, timeout: 60000 });
 const [run] = await sql`SELECT status,details FROM data_import_runs WHERE id=${id}`;
 expect(run.status).toBe('success'); expect(run.details.automatic_retry_count).toBe(1);
 expect((await sql`SELECT status FROM data_import_runs WHERE id=${original}`)[0].status).toBe('failed');
 expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-14'`)[0].sold_qty)).toBe(4);
 expect(recover()).toEqual([]);
});

test('scheduled enqueue-only mode recovers failures only for nightly stores and verified feeds', async ({ request }) => {
 for (const storeId of [1, 2]) {
  const saved = await request.put(`/api/automation/stores/${storeId}`, { headers: { origin: 'http://127.0.0.1:3100' }, data: { crmUrl: 'http://127.0.0.1:3201/', nightlyEnabled: false } });
  expect(saved.ok()).toBe(true);
 }
 await sql`UPDATE store_crm_settings SET nightly_enabled=true WHERE store_id=1`;
 const eligible = await failed('2026-10-14', 'TimeoutExpired', {}, 1, 'wastage');
 await failed('2026-10-14', 'TimeoutExpired', {}, 2, 'wastage');
 await failed('2026-10-14', 'TimeoutExpired', {}, 1, 'rtc');
 const folder = mkdtempSync(path.join(tmpdir(), 'mieszko-scheduled-recovery-'));
 const config = path.join(folder, 'config.json');
 writeFileSync(config, JSON.stringify({ store_settings_source: 'database', store_defaults: { feeds: { wastage: { complete_store_report: true }, rtc: { complete_store_report: false } } } }));
 const code = `import sys\nfrom datetime import date\nfrom automation import worker\nworker.london_today=lambda:date(2026,10,20)\nsys.argv=['worker','--config',sys.argv[1],'--enqueue-yesterday','--enqueue-only']\nworker.main()`;
 const run = () => execFileSync('python', ['-c', code, config], { env: { ...process.env, DATABASE_URL: connection }, encoding: 'utf8', timeout: 15000 });
 expect(run()).toContain('1 eligible failed reports');
 expect(run()).toContain('0 eligible failed reports');
 const jobs = await sql`SELECT * FROM data_import_runs WHERE status='queued' ORDER BY id`;
 expect(jobs).toHaveLength(2);
 expect(jobs.every(row => row.store_id === 1 && row.source_type === 'wastage')).toBe(true);
 expect(jobs[1].details.retry_of).toBe(eligible);
 expect(jobs[0].trigger_type).toBe('nightly');
});
