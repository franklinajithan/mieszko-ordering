import {apiOk,route} from '@/lib/api/http';
import {getControlCentre} from '@/services/operations/control-centre.service';
export const GET=route(async()=>apiOk(await getControlCentre()));
