const WORKER_COMMAND = "npm run worker:once";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

function createRenderSalesAgentTrigger({
  fetchFn = globalThis.fetch,
  env = process.env,
  timeoutMs = 15000,
} = {}) {
  return async function triggerSalesAgentRun() {
    if (typeof fetchFn !== "function") throw new Error("Render job trigger is unavailable.");
    const apiBaseUrl = required(env.RENDER_API_BASE_URL, "Render API base URL")
      .replace(/\/+$/, "");
    const serviceId = required(env.RENDER_SALES_AGENT_SERVICE_ID, "Render Sales Agent service");
    const apiKey = required(env.RENDER_API_KEY, "Render API credentials");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = { startCommand: WORKER_COMMAND };
      const planId = String(env.RENDER_SALES_AGENT_JOB_PLAN_ID || "").trim();
      if (planId) body.planId = planId;
      const response = await fetchFn(
        `${apiBaseUrl}/services/${encodeURIComponent(serviceId)}/jobs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      if (!response.ok) throw new Error("Render rejected the Sales Agent job trigger.");
      const payload = await response.json().catch(() => ({}));
      const jobId = String(payload.id || payload.job?.id || "").trim();
      if (!jobId) throw new Error("Render did not return a job identifier.");
      return { jobId };
    } finally {
      clearTimeout(timeout);
    }
  };
}

module.exports = {
  WORKER_COMMAND,
  createRenderSalesAgentTrigger,
};
