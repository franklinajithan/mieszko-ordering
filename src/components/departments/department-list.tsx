import { Badge } from "@/components/ui/badge";

import { DepartmentRowActions } from "@/components/departments/department-actions"
import type { Department } from "@/types/department";

const DepartmentList = ({ departments }: { departments: Department[] }) => {
  return (
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
                No departments yet. Add one above.
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
                <DepartmentRowActions department={department as Department} />
                </td>
            </tr>
            ))
        )}
        </tbody>
    </table>
    </div>
</section>

  );
};

export default DepartmentList;