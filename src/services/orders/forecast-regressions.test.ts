import { addDaysIso, todayIso } from "@/utils/order-sheet-form";
import { describe, expect, it, vi } from "vitest";
import { Decimal } from "@/utils/decimal";
import { WeekdayHistoricalForecastService } from "./sales-forecast.service";
import { compareSupplierPrices, type SupplierPriceInput } from "../supplier-prices/supplier-price.service";

const day = (value: string) => new Date(value + 'T00:00:00Z');
const supplier: SupplierPriceInput = { supplierId: 1, supplierKey: 'MM', supplierCode: '123', supplierName: 'MM', priceTiePriority: 1, hasMapping: true, netPrice: '1.20', caseSize: '6' };
describe('forecast and supplier regressions', () => {
  it('deduplicates overlapping history and forecasts an exclusive end date', async () => {
    const service = new WeekdayHistoricalForecastService();
    const value = await service.forecastProductSales({storeProductId: 1, fromDate: day('2026-10-19'), toDate: day('2026-10-20'), historicalSalesByDate: new Map([['2026-10-05', new Decimal(10)], ['2026-10-12', new Decimal(20)]]), periodRanges: [{startDate: day('2026-10-05'), endDate: day('2026-10-12')}, {startDate: day('2026-10-05'), endDate: day('2026-10-05')}]});
    expect(value.toString()).toBe('15');
  });
  it('does not forecast stock growth from net returns', async () => {
    expect((await new WeekdayHistoricalForecastService().forecastProductSales({storeProductId: 1, fromDate: day('2026-10-19'), toDate: day('2026-10-20'), historicalSalesByDate: new Map([['2026-10-12', new Decimal(-3)]]), periodRanges: [{startDate: day('2026-10-12'), endDate: day('2026-10-12')}]})).toString()).toBe('0');
  });
  it.each(['garbage', 'NaN', 'Infinity', '-1', '0'])('flags malformed price %s without crashing generation', netPrice => {
    expect(compareSupplierPrices([{...supplier, netPrice}], new Decimal(2)).priceStatus).toBe('check_invalid_price');
  });
  it('flags an empty supplier selection', () => expect(compareSupplierPrices([], new Decimal(2)).cheapestSupplierId).toBeNull());
  it('flags a blank mapping', () => expect(compareSupplierPrices([{...supplier, supplierCode: ' '}], new Decimal(2)).priceStatus).toBe('check_missing_code'));
  it('rejects negative quantities', () => expect(() => compareSupplierPrices([supplier], new Decimal(-1))).toThrow());
  it('breaks equal priority ties deterministically', () => expect(compareSupplierPrices([{...supplier, supplierId: 2}, supplier], new Decimal(2)).cheapestSupplierId).toBe(1));
});

it('uses the London business date near midnight', () => {
  vi.useFakeTimers();
  try { vi.setSystemTime(new Date('2026-10-15T23:30:00Z')); expect(todayIso()).toBe('2026-10-16'); }
  finally { vi.useRealTimers(); }
});
it('adds business days across daylight-saving changes without shifting dates', () => {
  expect(addDaysIso('2026-03-29',1)).toBe('2026-03-30');
  expect(addDaysIso('2026-10-25',1)).toBe('2026-10-26');
});
