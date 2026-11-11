import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { POST } from "@/app/api/weekly-wastage/[week]/redownload/route";
import { getWeeklyWastageRuns, openWeeklyWastageZip } from "./weekly-wastage.service";

vi.mock("server-only", () => ({}));

test("serves the previous ZIP while a redownload runs or after it fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "weekly-wastage-"));
  const week = "2026-11-02";
  const archive = path.join(root, "Weekly Waste 02.11.2026 - 08.11.2026");
  try {
    vi.stubEnv("WEEKLY_WASTAGE_DIRECTORY", root);
    await mkdir(path.join(root, ".status"));
    await mkdir(archive);
    await writeFile(path.join(archive, "Weekly_Wastage.zip"), "published ZIP");

    for (const state of ["running", "failed"]) {
      await writeFile(path.join(root, ".status", `${week}.json`), JSON.stringify({
        start: week, end: "2026-11-08", state, stage: "Fixture",
        stores: {}, updatedAt: new Date().toISOString(),
      }));
      expect((await getWeeklyWastageRuns()).runs[0]).toMatchObject({ state, hasZip: true });
      const result = await openWeeklyWastageZip(week);
      expect(result).not.toBeNull();
      try {
        expect(await result?.file.readFile("utf8")).toBe("published ZIP");
      } finally {
        await result?.file.close();
      }
    }

    const request = new Request("http://localhost", { method: "POST", headers: { Origin: "https://other.test" } });
    expect((await POST(request, { params: Promise.resolve({ week }) })).status).toBe(403);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test("launches a redownload using the configured worker runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "weekly-wastage-launch-"));
  const week = "2020-11-02";
  const worker = path.join(root, "worker checkout");
  try {
    vi.stubEnv("WEEKLY_WASTAGE_DIRECTORY", root);
    vi.stubEnv("WEEKLY_WASTAGE_WORKER_DIRECTORY", worker);
    await mkdir(path.join(root, ".status"));
    await writeFile(path.join(root, ".status", `${week}.json`), JSON.stringify({
      start: week, end: "2020-11-08", state: "complete", stage: "Fixture",
      stores: {}, updatedAt: new Date().toISOString(),
    }));

    const request = new Request("http://localhost", { method: "POST" });
    const context = { params: Promise.resolve({ week }) };
    const unavailable = await POST(request, context);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ error: expect.stringContaining("Python runtime") });

    const bin = path.join(worker, ".worker-runtime", "venv", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "python"), [
      "#!/bin/sh",
      'test "$1" = "$(dirname "$(dirname "$(dirname "$(dirname "$0")")")")/automation/weekly_wastage_job.py" || exit 1',
      'test "$2 $3 $4 $5" = "--redownload --week-start 2020-11-02 --output" || exit 1',
      "echo ready",
      "",
    ].join("\n"), { mode: 0o700 });
    await mkdir(path.join(worker, "automation"));
    await writeFile(path.join(worker, "automation", "weekly_wastage_job.py"), "fixture");
    expect((await POST(request, context)).status).toBe(202);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
