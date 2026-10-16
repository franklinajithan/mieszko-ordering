import {z} from 'zod';
import {problemTypes} from '@/types/operations';
export const qualityFilterSchema=z.object({storeId:z.coerce.number().int().positive().optional(),supplierId:z.coerce.number().int().positive().optional(),type:z.enum(problemTypes).optional(),search:z.string().max(200).optional(),page:z.coerce.number().int().min(1).max(100000).default(1)});
export function queryFilters(request:Request){return qualityFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));}
