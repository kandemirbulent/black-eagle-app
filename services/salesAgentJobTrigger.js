const WORKER_COMMAND = "npm run worker:once";
const DEFAULT_RENDER_API_BASE_URL = "https://api.render.com/v1";
const RENDER_TRIGGER_STAGE = "RENDER_TRIGGER";

function redactRenderDiagnostic(value, limit = 2000) {
  return String(value || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(["']?(?:password|secret|api.?key|token|cookie|authorization)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[REDACTED]")
    .replace(/(?:mongodb(?:\+srv)?:\/\/)[^\s"']+/gi, "[REDACTED_MONGODB_URI]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_OPENAI_KEY]")
    .slice(0, limit);
}

class RenderTriggerError extends Error {
  constructor(message, diagnostic = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "RenderTriggerError";
    this.code = diagnostic.errorCode || "RENDER_TRIGGER_FAILED";
    this.diagnostic = {
      triggerStage: RENDER_TRIGGER_STAGE,
      requestTimestamp: diagnostic.requestTimestamp || new Date().toISOString(),
      httpStatus: Number.isInteger(diagnostic.httpStatus) ? diagnostic.httpStatus : null,
      httpStatusText: redactRenderDiagnostic(diagnostic.httpStatusText, 200),
      responseBody: redactRenderDiagnostic(diagnostic.responseBody),
      renderErrorCode: redactRenderDiagnostic(diagnostic.renderErrorCode, 200),
      renderErrorMessage: redactRenderDiagnostic(diagnostic.renderErrorMessage, 500),
      errorCode: this.code,
      safeMessage: redactRenderDiagnostic(message, 700),
    };
  }
}

function required(value, name, errorCode, requestTimestamp) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new RenderTriggerError(`${name} is not configured.`, {
      errorCode,
      requestTimestamp,
      renderErrorMessage: `${name} is not configured.`,
    });
  }
  return normalized;
}

function responseReason(status, renderMessage) {
  const standard = {
    400: "invalid job request",
    401: "authentication failed",
    403: "API key lacks permission",
    404: "service ID was not found",
    422: "invalid job request payload",
    429: "rate limit exceeded",
  }[status];
  return redactRenderDiagnostic(renderMessage, 500) || standard || "Render rejected the job request";
}

function parseResponseBody(rawBody) {
  if (!rawBody) return { payload: null, renderErrorCode: "", renderErrorMessage: "" };
  try {
    const payload = JSON.parse(rawBody);
    const error = payload?.error && typeof payload.error === "object" ? payload.error : {};
    return {
      payload,
      renderErrorCode: payload?.code || error.code || "",
      renderErrorMessage: payload?.message || error.message || payload?.errorMessage || "",
    };
  } catch (_error) {
    return { payload: null, renderErrorCode: "", renderErrorMessage: rawBody };
  }
}

function createRenderSalesAgentTrigger({
  fetchFn = globalThis.fetch,
  env = process.env,
  timeoutMs = 15000,
  now = () => new Date(),
} = {}) {
  return async function triggerSalesAgentRun() {
    const requestTimestamp = now().toISOString();
    if (typeof fetchFn !== "function") {
      throw new RenderTriggerError("Render job trigger is unavailable.", {
        errorCode: "RENDER_FETCH_UNAVAILABLE",
        requestTimestamp,
      });
    }
    const apiBaseUrl = String(env.RENDER_API_BASE_URL || DEFAULT_RENDER_API_BASE_URL).trim().replace(/\/+$/, "");
    const serviceId = required(env.RENDER_SALES_AGENT_SERVICE_ID, "Render Sales Agent service ID", "RENDER_SERVICE_ID_MISSING", requestTimestamp);
    const apiKey = required(env.RENDER_API_KEY, "Render API key", "RENDER_API_KEY_MISSING", requestTimestamp);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = { startCommand: WORKER_COMMAND };
      const planId = String(env.RENDER_SALES_AGENT_JOB_PLAN_ID || "").trim();
      if (planId) body.planId = planId;
      let response;
      try {
        response = await fetchFn(
          `${apiBaseUrl}/services/${encodeURIComponent(serviceId)}/jobs`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );
      } catch (error) {
        const timedOut = error?.name === "AbortError";
        throw new RenderTriggerError(
          timedOut ? "Render API request timed out." : "Render API network request failed.",
          { errorCode: timedOut ? "RENDER_REQUEST_TIMEOUT" : "RENDER_NETWORK_ERROR", requestTimestamp },
          error
        );
      }
      const rawBody = await response.text().catch(() => "");
      const parsed = parseResponseBody(rawBody);
      if (!response.ok) {
        const statusText = String(response.statusText || "").trim();
        const reason = responseReason(response.status, parsed.renderErrorMessage);
        throw new RenderTriggerError(
          `Render API returned ${response.status} ${statusText || "Error"}: ${reason}`,
          {
            errorCode: parsed.renderErrorCode || `RENDER_HTTP_${response.status}`,
            requestTimestamp,
            httpStatus: response.status,
            httpStatusText: statusText,
            responseBody: rawBody,
            renderErrorCode: parsed.renderErrorCode,
            renderErrorMessage: parsed.renderErrorMessage || reason,
          }
        );
      }
      const payload = parsed.payload || {};
      const jobId = String(payload.id || payload.job?.id || "").trim();
      if (!jobId) {
        throw new RenderTriggerError("Render API succeeded but did not return a job identifier.", {
          errorCode: "RENDER_JOB_ID_MISSING",
          requestTimestamp,
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseBody: rawBody,
        });
      }
      return { jobId };
    } finally {
      clearTimeout(timeout);
    }
  };
}

module.exports = {
  DEFAULT_RENDER_API_BASE_URL,
  RENDER_TRIGGER_STAGE,
  RenderTriggerError,
  WORKER_COMMAND,
  createRenderSalesAgentTrigger,
  redactRenderDiagnostic,
};
