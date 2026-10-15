/** Next may construct request.url with an internal hostname; Host is the browser-facing authority. */
export function isSameOriginSubmission(request:Request):boolean {
  const origin=request.headers.get('origin');
  if (!origin) return true; // Trusted non-browser callers do not send Origin.
  try {
    const parsed=new URL(origin);
    const authority=request.headers.get('host') ?? new URL(request.url).host;
    return ['http:','https:'].includes(parsed.protocol) && parsed.host.toLowerCase()===authority.toLowerCase();
  } catch {return false;}
}
