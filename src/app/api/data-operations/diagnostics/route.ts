import {NextResponse} from 'next/server';
import {apiError,route} from '@/lib/api/http';
import {getDiagnostics} from '@/services/operations/diagnostics.service';
import {queryFilters} from '@/services/operations/filters';
export const GET=route(async request=>{
 const parsed=queryFilters(request);if(!parsed.success)return apiError('Invalid store filter');
 return new NextResponse(JSON.stringify(await getDiagnostics(parsed.data.storeId),null,2),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="Mieszko-import-diagnostics.json"','Cache-Control':'no-store'}});
});
