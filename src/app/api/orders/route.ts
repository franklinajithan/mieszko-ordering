import { orderRepository } from "@/repositories";
import { createOrderSchema } from "@/validators/schemas";
import { apiOk, parseJson, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const parsed = await parseJson(req, createOrderSchema);
  if (!parsed.ok) return parsed.response;
  const order = await orderRepository.create({
    ...parsed.data,
    status: "draft",
  });
  return apiOk({ id: order.id }, 201);
});
