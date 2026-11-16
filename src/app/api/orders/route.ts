import { orderRepository } from "@/repositories";
import { createOrderSchema } from "@/validators/schemas";
import { apiOk, parseJson, route } from "@/lib/api/http";

export const GET = route(async () => {
  const orders = await orderRepository.list();
  return apiOk(orders);
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, createOrderSchema);
  if (!parsed.ok) return parsed.response;
  const order = await orderRepository.create({
    ...parsed.data,
    dayBySalesStartDate: parsed.data.dayBySalesStartDate ?? null,
    dayBySalesEndDate: parsed.data.dayBySalesEndDate ?? null,
    comment: parsed.data.comment ?? null,
    status: "draft",
  });
  return apiOk({ id: order.id }, 201);
});
