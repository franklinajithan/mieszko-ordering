"use client";

export function ReportDate({ date }: { date: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1.5 text-sm font-medium">
        Report date
        <input
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2"
          type="date"
          name="date"
          defaultValue={date}
          required
          onChange={(event) => {
            if (event.currentTarget.value) event.currentTarget.form?.requestSubmit();
          }}
        />
      </label>
      <button className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50" type="submit">
        Show files
      </button>
    </form>
  );
}
