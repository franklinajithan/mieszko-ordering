import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";

export function launchOfficeReportWorker(
  config: { worker: string; archive: string },
  script: "item_sales_enquiry.py" | "report_downloader.py",
  payload: unknown,
) {
  return new Promise<{ status: "ready" | "busy" | "unavailable" }>(resolve => {
    const child = spawn(path.join(config.worker, ".worker-runtime/venv/bin/python"), [
      path.join(process.cwd(), "automation", script),
      "--worker-directory", config.worker, "--archive", config.archive,
    ], { detached: true, stdio: ["pipe", "pipe", "ignore"] });
    function finish(status: "ready" | "busy" | "unavailable") {
      clearTimeout(timer);
      child.stdout.destroy();
      child.unref();
      resolve({ status });
    }
    const timer = setTimeout(() => {
      child.kill();
      finish("unavailable");
    }, 10_000);
    child.once("error", () => finish("unavailable"));
    child.once("close", () => finish("unavailable"));
    child.stdin.on("error", () => {}); // The child can exit before reading stdin.
    let output = "";
    child.stdout.on("data", chunk => {
      output += String(chunk);
      if (output.includes("\n")) {
        const line = output.split("\n", 1)[0];
        finish(line === "ready" || line === "busy" ? line : "unavailable");
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
