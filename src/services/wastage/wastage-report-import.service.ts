import {validateMovementReport,importMovementReport} from '@/services/movement-report-import.service';

export function validateWastageReport(input:Parameters<typeof validateMovementReport>[0]) {return validateMovementReport(input,'wastage');}
export function importWastageReport(input:Parameters<typeof importMovementReport>[0]) {return importMovementReport(input,'wastage');}
