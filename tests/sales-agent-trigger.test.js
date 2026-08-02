const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_RENDER_API_BASE_URL,
  MANUAL_REVIEW_WORKER_COMMAND,
  WORKER_COMMAND,
  createRenderSalesAgentTrigger,
  redactRenderDiagnostic,
} = require("../services/salesAgentJobTrigger");

const fixedNow = () => new Date("2026-07-31T12:00:00.000Z");
const baseEnv = {
  RENDER_API_KEY: "test-render-api-key",
  RENDER_SALES_AGENT_SERVICE_ID: "srv_test_sales_agent",
};

function response(status, statusText, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
  };
}

test("successful One-Off Job creation uses the official endpoint and supported payload", async () => {
  const calls = [];
  const trigger = createRenderSalesAgentTrigger({
    env: { ...baseEnv, RENDER_SALES_AGENT_JOB_PLAN_ID: "plan-srv-006" },
    now: fixedNow,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return response(201, "Created", { id: "job-123" });
    },
  });
  assert.deepEqual(await trigger(), { jobId: "job-123" });
  assert.equal(calls[0].url, `${DEFAULT_RENDER_API_BASE_URL}/services/srv_test_sales_agent/jobs`);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-render-api-key");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    startCommand: WORKER_COMMAND,
    planId: "plan-srv-006",
  });
});

test("manual review trigger uses the dedicated resume command", async () => {
  const calls = [];
  const trigger = createRenderSalesAgentTrigger({
    env: baseEnv,
    now: fixedNow,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return response(201, "Created", { id: "job-manual-review" });
    },
  });
  await trigger({
    startCommand: MANUAL_REVIEW_WORKER_COMMAND,
    sourceRunId: "64d000000000000000000003",
    persistedSourceRunId: "64d000000000000000000003",
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    startCommand: "npm run worker:submit-manual-review",
  });
});

test("manual review source-run mismatch stops before the Render request", async () => {
  let called = false;
  const trigger = createRenderSalesAgentTrigger({
    env: baseEnv,
    now: fixedNow,
    fetchFn: async () => { called = true; },
  });
  await assert.rejects(trigger({
    startCommand: MANUAL_REVIEW_WORKER_COMMAND,
    sourceRunId: "64d000000000000000000003",
    persistedSourceRunId: "64d000000000000000000004",
  }), (error) => error.code === "MANUAL_REVIEW_SOURCE_RUN_MISMATCH");
  assert.equal(called, false);
});

test("a deploy-hook RENDER_API_BASE_URL cannot redirect the trigger into a deployment", async () => {
  const calls = [];
  const trigger = createRenderSalesAgentTrigger({
    env: {
      ...baseEnv,
      RENDER_API_BASE_URL: "https://api.render.com/deploy/srv_wrong?key=deploy-hook-secret",
    },
    now: fixedNow,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return response(201, "Created", { id: "job-456" });
    },
  });
  assert.deepEqual(await trigger(), { jobId: "job-456" });
  assert.equal(calls[0].url, `${DEFAULT_RENDER_API_BASE_URL}/services/srv_test_sales_agent/jobs`);
  assert.doesNotMatch(calls[0].url, /\/deploy\//);
  assert.deepEqual(JSON.parse(calls[0].options.body), { startCommand: WORKER_COMMAND });
});

test("missing RENDER_API_KEY fails before a request", async () => {
  let called = false;
  const trigger = createRenderSalesAgentTrigger({
    env: { RENDER_SALES_AGENT_SERVICE_ID: baseEnv.RENDER_SALES_AGENT_SERVICE_ID },
    fetchFn: async () => { called = true; },
    now: fixedNow,
  });
  await assert.rejects(trigger(), (error) => error.code === "RENDER_API_KEY_MISSING" && /API key is not configured/.test(error.message));
  assert.equal(called, false);
});

test("missing RENDER_SALES_AGENT_SERVICE_ID fails before a request", async () => {
  let called = false;
  const trigger = createRenderSalesAgentTrigger({
    env: { RENDER_API_KEY: baseEnv.RENDER_API_KEY },
    fetchFn: async () => { called = true; },
    now: fixedNow,
  });
  await assert.rejects(trigger(), (error) => error.code === "RENDER_SERVICE_ID_MISSING" && /service ID is not configured/.test(error.message));
  assert.equal(called, false);
});

for (const [status, statusText, expectedReason] of [
  [401, "Unauthorized", "authentication failed"],
  [403, "Forbidden", "API key lacks permission"],
  [404, "Not Found", "service ID was not found"],
  [422, "Unprocessable Entity", "invalid job request payload"],
  [429, "Too Many Requests", "rate limit exceeded"],
]) {
  test(`${status} Render response preserves safe HTTP diagnostics`, async () => {
    const trigger = createRenderSalesAgentTrigger({
      env: baseEnv,
      now: fixedNow,
      fetchFn: async () => response(status, statusText, { code: `render-${status}`, message: "" }),
    });
    await assert.rejects(trigger(), (error) => {
      assert.equal(error.diagnostic.httpStatus, status);
      assert.equal(error.diagnostic.httpStatusText, statusText);
      assert.equal(error.diagnostic.renderErrorCode, `render-${status}`);
      assert.equal(error.diagnostic.requestTimestamp, fixedNow().toISOString());
      assert.match(error.message, new RegExp(`Render API returned ${status} ${statusText}`));
      assert.match(error.message, new RegExp(expectedReason, "i"));
      return true;
    });
  });
}

test("non-JSON Render response is safely preserved", async () => {
  const trigger = createRenderSalesAgentTrigger({
    env: baseEnv,
    now: fixedNow,
    fetchFn: async () => response(500, "Internal Server Error", "upstream unavailable"),
  });
  await assert.rejects(trigger(), (error) => {
    assert.equal(error.diagnostic.responseBody, "upstream unavailable");
    assert.match(error.message, /upstream unavailable/);
    return true;
  });
});

test("network failure is classified without leaking the underlying secret", async () => {
  const trigger = createRenderSalesAgentTrigger({
    env: baseEnv,
    now: fixedNow,
    fetchFn: async () => { throw new Error("network failed with token=private-token"); },
  });
  await assert.rejects(trigger(), (error) => {
    assert.equal(error.code, "RENDER_NETWORK_ERROR");
    assert.equal(error.message, "Render API network request failed.");
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /private-token/);
    return true;
  });
});

test("Render response diagnostics redact secrets", async () => {
  const trigger = createRenderSalesAgentTrigger({
    env: baseEnv,
    now: fixedNow,
    fetchFn: async () => response(403, "Forbidden", {
      code: "permission_denied",
      message: "Bearer private-token api_key=private-key",
    }),
  });
  await assert.rejects(trigger(), (error) => {
    const diagnostic = JSON.stringify(error.diagnostic);
    assert.doesNotMatch(diagnostic, /private-token|private-key/);
    assert.match(diagnostic, /REDACTED/);
    return true;
  });
  assert.doesNotMatch(redactRenderDiagnostic("mongodb+srv://user:pass@example.invalid/db"), /user|pass/);
  assert.doesNotMatch(redactRenderDiagnostic("sk-exampleOpenAISecret123"), /exampleOpenAISecret/);
});
