import type { ActionResult } from "@/types";

/**
 * Base URL for the API. Defaults to the same-origin Next route handlers under
 * `/api`. Set `NEXT_PUBLIC_API_URL` (e.g. to a FastAPI service) to move the
 * backend without touching call sites.
 */
const RAW_BASE = process.env.NEXT_PUBLIC_API_URL?.trim();

function resolveAppOrigin(): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (configured) return configured.replace(/\/+$/, "");
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/** Resolves the API base URL for browser and server (RSC) callers. */
export function resolveApiBaseUrl(): string {
  if (RAW_BASE) return RAW_BASE.replace(/\/+$/, "");
  if (typeof window !== "undefined") return "/api";
  return `${resolveAppOrigin()}/api`;
}

export const API_BASE_URL = resolveApiBaseUrl();

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function parseEnvelope<T>(response: Response): Promise<ActionResult<T>> {
  const payload = await response.json().catch(() => null);

  if (payload && typeof payload === "object" && "success" in payload) {
    return payload as ActionResult<T>;
  }

  if (!response.ok) {
    return {
      success: false,
      error: `Request failed (${response.status})`,
    };
  }

  return { success: true, data: payload as T };
}

export async function apiRequest<T>(
  path: string,
  options: { method?: Method; body?: unknown } = {},
): Promise<ActionResult<T>> {
  const { method = "GET", body } = options;
  try {
    const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
      method,
      headers:
        body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: method === "GET" ? "no-store" : undefined,
    });
    return parseEnvelope<T>(response);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/** Multipart / FormData requests (file uploads). Do not set Content-Type. */
export async function apiFormRequest<T>(
  path: string,
  formData: FormData,
  options: { method?: "POST" | "PUT" | "PATCH" } = {},
): Promise<ActionResult<T>> {
  const { method = "POST" } = options;
  try {
    const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
      method,
      body: formData,
    });
    return parseEnvelope<T>(response);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}
