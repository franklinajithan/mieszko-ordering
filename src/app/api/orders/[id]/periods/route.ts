import { z } from "zod";
import { orderRepository } from "@/repositories";
import { updateOrderPeriodsSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

const bodySchema = z.object({
  periods: z.array(
    z.object({
      periodKey: z.enum(["period_1", "period_2", "period_3", "previous_year"]),
      startDate: z.string(),
      endDate: z.string(),
    }),
  ),
});

export const PUT = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");

    const body = await parseJson(req, bodySchema);
    if (!body.ok) return body.response;

    const parsed = updateOrderPeriodsSchema.safeParse({
      orderId,
      periods: body.data.periods,
    });
    if (!parsed.success) return apiError(parsed.error.message);

    await orderRepository.replacePeriods(
      parsed.data.orderId,
      parsed.data.periods.map((p) => ({
        orderId: parsed.data.orderId,
        periodKey: p.periodKey,
        startDate: p.startDate,
        endDate: p.endDate,
      })),
    );
    return apiOk(null);
  },
);
