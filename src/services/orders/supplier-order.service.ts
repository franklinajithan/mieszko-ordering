import {assertOrderReadyForExport} from './order-validation.service';
import { InputError } from "@/utils/input-error";
import 'server-only';
import ExcelJS from 'exceljs';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, orderItems, products, storeProducts, stores, suppliers, supplierOrders, type SupplierOrderLine } from '@/db/schema';
import { Decimal, decimalToDb, parseDbDecimal } from '@/utils/decimal';

/** Build downloadable supplier drafts only; never emails or submits an order. */
export async function generateSupplierOrders(orderId: number,options:{acknowledgeWarnings?:boolean}={}) {
  const validation=await assertOrderReadyForExport(orderId,options.acknowledgeWarnings);
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(eq(orders.id,orderId)).for('update');
    if (!order) throw new InputError('Order not found');
    if(order.revision!==validation.revision)throw new InputError('Order changed during validation. Review it again.');
    const items = await tx.select({item:orderItems,storeProduct:storeProducts,product:products})
      .from(orderItems).innerJoin(storeProducts,eq(storeProducts.id,orderItems.storeProductId))
      .innerJoin(products,eq(products.id,storeProducts.productId)).where(eq(orderItems.orderId,orderId));
    const groups = new Map<string,{storeId:number;supplierId:number;lines:SupplierOrderLine[];total:Decimal}>();
    const unpriced: string[] = [];
    for (const {item,storeProduct,product} of items) {
      const quantity=parseDbDecimal(item.finalOrderQty);
      if (!quantity.isFinite() || quantity.isNegative()) throw new InputError('Invalid saved order quantity');
      if (quantity.isZero()) continue;
      const quote=item.supplierQuotes.find(quote=>quote.supplierId===item.cheapestSupplierId && quote.isCheapest);
      if (!quote || quote.priceValidationStatus!=='valid' || !quote.supplierProductCode?.trim() || !item.cheapestNetPrice || item.priceStatus!=='complete') {
        unpriced.push(`${storeProduct.storeId}/${storeProduct.storeProductCode}`); continue;
      }
      const price=parseDbDecimal(item.cheapestNetPrice);
      if (!price.isFinite() || !price.gt(0)) throw new InputError('Invalid chosen supplier price');
      const key=`${storeProduct.storeId}:${quote.supplierId}`;
      const group=groups.get(key) ?? {storeId:storeProduct.storeId,supplierId:quote.supplierId,lines:[],total:new Decimal(0)};
      const lineCost=quantity.times(price);
      group.lines.push({storeProductId:storeProduct.id,itemCode:storeProduct.storeProductCode,productName:product.name,supplierCode:quote.supplierProductCode,quantity:decimalToDb(quantity),unitPrice:decimalToDb(price),lineCost:decimalToDb(lineCost),caseSize:quote.caseSize});
      group.total=group.total.plus(lineCost); groups.set(key,group);
    }
    // Fail the whole operation rather than silently omit a selected line.
    if (unpriced.length) throw new InputError(`Resolve supplier prices for ${unpriced.length} selected lines: ${unpriced.slice(0,10).join(', ')}`);
    if (!groups.size) throw new InputError('Select at least one product with a positive quantity');
    const [activeStores,activeSuppliers]=await Promise.all([tx.select().from(stores),tx.select().from(suppliers)]);
    for (const group of groups.values()) {
      if (!activeStores.some(store=>store.id===group.storeId && store.isActive) || !activeSuppliers.some(supplier=>supplier.id===group.supplierId && supplier.isActive)) throw new InputError('A selected store or supplier is inactive');
    }
    const results: Array<typeof supplierOrders.$inferSelect> = [];
    for (const group of groups.values()) {
      const value={orderId,storeId:group.storeId,supplierId:group.supplierId,deliveryDate:order.deliveryDate,totalNetCost:decimalToDb(group.total),lines:group.lines,sourceRevision:order.revision,sourceUpdatedAt:order.updatedAt,generatedAt:new Date(),exportedAt:null};
      const [saved]=await tx.insert(supplierOrders).values(value).onConflictDoUpdate({target:[supplierOrders.orderId,supplierOrders.storeId,supplierOrders.supplierId],set:value}).returning();
      results.push(saved);
    }
    const existing=await tx.select().from(supplierOrders).where(eq(supplierOrders.orderId,orderId));
    for (const row of existing) if (!groups.has(`${row.storeId}:${row.supplierId}`)) await tx.delete(supplierOrders).where(eq(supplierOrders.id,row.id));
    return results;
  });
}

export async function listSupplierOrders(orderId: number) {
  const [order]=await db.select().from(orders).where(eq(orders.id,orderId));
  if (!order) throw new InputError('Order not found');
  const rows=await db.select({draft:supplierOrders,storeName:stores.name,supplierName:suppliers.name}).from(supplierOrders)
    .innerJoin(stores,eq(stores.id,supplierOrders.storeId)).innerJoin(suppliers,eq(suppliers.id,supplierOrders.supplierId)).where(eq(supplierOrders.orderId,orderId));
  return rows.map(({draft,...names})=>({...draft,...names,stale:draft.sourceRevision!==order.revision}));
}

export async function exportSupplierOrder(orderId: number, supplierOrderId: number,options:{acknowledgeWarnings?:boolean}={}) {
  const validation=await assertOrderReadyForExport(orderId,options.acknowledgeWarnings);
  return db.transaction(async tx=>{
  const [locked]=await tx.select().from(orders).where(eq(orders.id,orderId)).for('update');
  if(!locked||locked.revision!==validation.revision)throw new InputError('Order changed during validation. Review it again.');
  const [row]=await tx.select({draft:supplierOrders,order:orders,storeName:stores.name,supplierName:suppliers.name}).from(supplierOrders)
    .innerJoin(orders,eq(orders.id,supplierOrders.orderId)).innerJoin(stores,eq(stores.id,supplierOrders.storeId))
    .innerJoin(suppliers,eq(suppliers.id,supplierOrders.supplierId)).where(and(eq(supplierOrders.id,supplierOrderId),eq(supplierOrders.orderId,orderId)));
  if (!row) throw new InputError('Supplier order not found');
  if(row.order.revision!==validation.revision)throw new InputError('Order changed during validation. Review it again.');
  if (row.draft.sourceRevision!==row.order.revision) throw new InputError('Order quantities or settings changed. Regenerate supplier orders before exporting.');
  const book=new ExcelJS.Workbook();
  const sheet=book.addWorksheet('Supplier Order');
  sheet.addRow(['Mieszko supplier order',row.draft.id]);
  sheet.addRow(['Store',row.storeName,'Supplier',row.supplierName]);
  sheet.addRow(['Delivery date',row.draft.deliveryDate,'Source order',orderId]);
  sheet.addRow(['Supplier code','Item code','Product','Units','Net unit price','Net line cost','Case size (reference)']);
  for (const line of row.draft.lines) sheet.addRow([line.supplierCode,line.itemCode,line.productName,Number(line.quantity),Number(line.unitPrice),Number(line.lineCost),line.caseSize ?? '']);
  sheet.addRow(['','','Total','','',Number(row.draft.totalNetCost)]);
  sheet.getRow(4).font={bold:true}; sheet.views=[{state:'frozen',ySplit:4}];
  sheet.autoFilter={from:{row:4,column:1},to:{row:4,column:7}};
  sheet.columns.forEach((column,index)=>{column.width=index===2?45:22;});
  for (const index of [4,5,6]) sheet.getColumn(index).numFmt='#,##0.0000';
  const buffer=await book.xlsx.writeBuffer();
  await tx.update(supplierOrders).set({exportedAt:new Date()}).where(and(eq(supplierOrders.id,supplierOrderId),eq(supplierOrders.sourceRevision,validation.revision)));
  return {base64:Buffer.from(buffer).toString('base64'),fileName:`Mieszko-order-${orderId}-store-${row.draft.storeId}-supplier-${row.draft.supplierId}.xlsx`};
  });
}
