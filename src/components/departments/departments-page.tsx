import { AppShell } from "@/components/layout/app-shell";
import { DepartmentRowActions } from "@/components/departments/department-actions";
import { DepartmentForm } from "@/components/departments/department-form";
import { DepartmentImportForm } from "@/components/departments/department-import-form";
import { Badge } from "@/components/ui/badge";

type Department = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
};

export function DepartmentsPageView({
  departments,
}: {
  departments: Department[];
}) {
  return (
    <AppShell
      title="Departments"
      description="Manage product departments used for catalog grouping and order filtering."
    >
      <div className="space-y-8">
        <DepartmentForm />

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">All departments</h2>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-zinc-500"
                    >
                      No departments yet. Add one above or import from Excel.
                    </td>
                  </tr>
                ) : (
                  departments.map((department) => (
                    <tr key={department.id}>
                      <td className="px-4 py-3 font-medium">{department.name}</td>
                      <td className="px-4 py-3">{department.code ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge
                          status={department.isActive ? "active" : "inactive"}
                        >
                          {department.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <DepartmentRowActions department={department} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <DepartmentImportForm />
      </div>
    </AppShell>
  );
}
