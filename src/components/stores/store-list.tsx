"use client";
import { Store } from '@/types'
import { Badge } from '@/components/ui/badge'
import { StoreErpSelect, StoreToggleButton } from '@/components/stores/store-actions'

export const StoreList = ({ stores }: { stores: Store[] }) => {
return (
    <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left">
                <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">ERP</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                </tr>
            </thead>
            <tbody>
                {stores.map((store) => (
                    <tr key={store.id}>
                        <td className="px-4 py-3 font-medium">{store.code}</td>
                        <td className="px-4 py-3">{store.name}</td>
                        <td className="px-4 py-3">
                            <StoreErpSelect id={store.id} erpType={store.erpType} />
                        </td>
                        <td className="px-4 py-3">
                            <Badge status={store.isActive ? "active" : "inactive"}>
                                {store.isActive ? "Active" : "Inactive"}
                            </Badge>
                        </td>
                        <td className="px-4 py-3">
                            <StoreToggleButton
                                id={store.id}
                                isActive={store.isActive}
                            />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
)
}