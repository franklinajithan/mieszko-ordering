import {AppShell} from '@/components/layout/app-shell';
import {DataQualityCentre} from '@/components/operations/data-quality-centre';
import {storeRepository,supplierRepository} from '@/repositories';
export default async function DataQualityPage({searchParams}:{searchParams:Promise<{storeId?:string}>}){
 const [stores,suppliers,query]=await Promise.all([storeRepository.list(),supplierRepository.list(),searchParams]);
 return <AppShell title="Data Quality Centre" description="Find, filter and export unresolved operational data problems."><DataQualityCentre stores={stores} suppliers={suppliers} initialStoreId={query.storeId??''} /></AppShell>;
}
