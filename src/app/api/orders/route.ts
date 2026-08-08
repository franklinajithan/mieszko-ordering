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
  const { departmentFilters, ...rest } = parsed.data;
  const order = await orderRepository.create({
    ...rest,
    departmentFilters: departmentFilters.map(String),
    status: "draft",
  });
  return apiOk({ id: order.id }, 201);
});
