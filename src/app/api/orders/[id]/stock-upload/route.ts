import { uploadOrderStockFromForm } from "@/services/stock-upload.service";
import { apiError, apiOk, numericParam, route } from "@/lib/api/http";

export const POST = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");

    const formData = await req.formData();
    formData.set("orderId", String(orderId));
    return apiOk(await uploadOrderStockFromForm(formData));
  },
);
