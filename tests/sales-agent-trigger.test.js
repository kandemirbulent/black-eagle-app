const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WORKER_COMMAND,
  createRenderSalesAgentTrigger,
} = require("../services/salesAgentJobTrigger");

test("Render trigger creates one one-off worker:once job without exposing credentials", async () => {
  const calls = [];
  const trigger = createRenderSalesAgentTrigger({
    env: {
      RENDER_API_BASE_URL: "https://render.invalid/v1",
      RENDER_API_KEY: "test-render-api-key",
      RENDER_SALES_AGENT_SERVICE_ID: "srv_test_sales_agent",
      RENDER_SALES_AGENT_JOB_PLAN_ID: "plan_test_one_off",
    },
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() { return { id: "job-123" }; },
      };
    },
  });
  const result = await trigger({ runId: "run-1" });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://render.invalid/v1/services/srv_test_sales_agent/jobs"
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    startCommand: WORKER_COMMAND,
    planId: "plan_test_one_off",
  });
  assert.deepEqual(result, { jobId: "job-123" });
  assert.equal(JSON.stringify(result).includes("test-render-api-key"), false);
});

test("Render trigger rejects missing server-side configuration safely", async () => {
  const trigger = createRenderSalesAgentTrigger({
    env: {},
    fetchFn: async () => {
      throw new Error("fetch should not run");
    },
  });
  await assert.rejects(trigger(), /not configured/);
});
