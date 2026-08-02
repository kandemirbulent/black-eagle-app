const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { RenderTriggerError } = require("../services/salesAgentJobTrigger");

const {
  createSalesAgentRouter,
  overlayCanonicalLatest,
  queuedTimeoutMs,
  redactFailureLog,
} = require("../routes/salesAgentRoutes");

const ADMIN_ID = "64b000000000000000000001";
const SUPERADMIN_ID = "64b000000000000000000002";

function query(value) {
  return {
    sort() { return this; },
    limit() { return this; },
    select() { return this; },
    async lean() { return structuredClone(value); },
  };
}

function createHarness({
  triggerSalesAgentRun,
  initialRuns = [],
  env = {},
  now = () => new Date(),
  persistedSourceRunOverride = "",
} = {}) {
  const state = {
    runs: structuredClone(initialRuns),
    results: [],
    settings: null,
    sequence: initialRuns.length + 1,
    triggerCalls: [],
  };
  const trigger = triggerSalesAgentRun || (async (input) => {
    state.triggerCalls.push(input);
    return { jobId: `job-${state.triggerCalls.length}` };
  });
  const SalesAgentRun = {
    async create(input) {
      if (state.runs.some((run) => ["QUEUED", "RUNNING"].includes(run.status) && run.activeLock === input.activeLock)) {
        const error = new Error("duplicate");
        error.code = 11000;
        throw error;
      }
      const run = {
        _id: `64c${String(state.sequence++).padStart(21, "0")}`,
        ...structuredClone(input),
        totals: {
          opportunitiesFound: 0, quotesSubmitted: 0, manualReview: 0, skipped: 0,
          failed: 0, openAiCalls: 0, platformActions: 0,
        },
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      };
      state.runs.push(run);
      return structuredClone(run);
    },
    find() { return query(state.runs.slice().reverse()); },
    findById(id) {
      const found = state.runs.find((run) => run._id === id) || null;
      const value = found && persistedSourceRunOverride && found.runType === "MANUAL_REVIEW_RESUME"
        ? { ...found, sourceRunId: persistedSourceRunOverride }
        : found;
      return query(value);
    },
    async findByIdAndUpdate(id, update) {
      const run = state.runs.find((item) => item._id === id);
      if (!run) return null;
      Object.assign(run, structuredClone(update.$set || {}), { updatedAt: new Date().toISOString() });
      return structuredClone(run);
    },
    async findOneAndUpdate(filter, update) {
      const cutoff = filter?.$or?.[0]?.updatedAt?.$lt;
      const run = state.runs.find((item) => {
        if (item.status !== filter.status) return false;
        const timestamp = item.updatedAt || item.createdAt;
        return cutoff instanceof Date && new Date(timestamp) < cutoff;
      });
      if (!run) return null;
      Object.assign(run, structuredClone(update.$set || {}));
      return structuredClone(run);
    },
    findOne(filter) {
      if (filter?.runType === "MANUAL_REVIEW_RESUME") {
        return query(state.runs.slice().reverse().find((run) =>
          run.runType === filter.runType && String(run.sourceRunId) === String(filter.sourceRunId)
        ) || null);
      }
      const statuses = filter?.status?.$in || [];
      return query(state.runs.find((run) => statuses.includes(run.status) && run.runType !== "MANUAL_REVIEW_RESUME") || null);
    },
  };
  const SalesAgentOpportunityResult = {
    async countDocuments(filter) {
      return state.results.filter((result) =>
        String(result.runId) === String(filter.runId) && result.resultStatus === filter.resultStatus
      ).length;
    },
    find(filter) {
      if (Array.isArray(filter?.$or)) {
        return query(state.results.filter((result) => filter.$or.some((key) =>
          result.platform === key.platform && result.opportunityId === key.opportunityId
        )));
      }
      return query(state.results.filter((result) => result.runId === filter.runId));
    },
  };
  const SalesAgentSettings = {
    findOne() { return query(state.settings); },
    findOneAndUpdate(filter, update) {
      state.settings = {
        key: filter.key,
        autoRunEnabled: false,
        autoSubmitEnabled: false,
        maxOpenAiCallsPerRun: 0,
        maxOpenAiCallsPerDay: 0,
        ...(state.settings || {}),
        ...update.$set,
        updatedAt: new Date().toISOString(),
      };
      return query(state.settings);
    },
  };
  function requireAdminAuth(req, res, next) {
    const role = req.headers["x-test-role"];
    if (!["admin", "superadmin"].includes(role)) {
      return res.status(401).json({ success: false });
    }
    req.adminUser = { _id: role === "superadmin" ? SUPERADMIN_ID : ADMIN_ID, role };
    return next();
  }
  function requireSuperAdmin(req, res, next) {
    if (req.adminUser?.role !== "superadmin") {
      return res.status(403).json({ success: false });
    }
    return next();
  }

  const app = express();
  app.use(express.json());
  app.use("/api", createSalesAgentRouter({
    requireAdminAuth,
    requireSuperAdmin,
    SalesAgentRun,
    SalesAgentOpportunityResult,
    SalesAgentSettings,
    triggerSalesAgentRun: trigger,
    env,
    now,
    logger: { error() {} },
  }));
  return { app, state };
}

async function withServer(run, options) {
  const { app, state } = createHarness(options);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  const request = (path, options = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, options);
  try {
    await run({ request, state });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function jsonOptions(role, method = "GET", body) {
  return {
    method,
    headers: { "content-type": "application/json", "x-test-role": role },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

test("Admin can create a queued Sales Agent run", () => withServer(async ({ request }) => {
  const response = await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.run.status, "QUEUED");
  assert.equal(body.run.triggeredByRole, "admin");
  assert.equal(body.run.triggerStatus, "TRIGGERED");
}));

test("manual review resume requires an explicit valid source run with review records", () => withServer(async ({ request, state }) => {
  const missing = await request("/api/admin/sales-agent/manual-review-runs", jsonOptions("admin", "POST", {}));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, "SOURCE_RUN_ID_REQUIRED");

  const invalid = await request("/api/admin/sales-agent/manual-review-runs", jsonOptions("admin", "POST", { sourceRunId: "bad" }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_SOURCE_RUN_ID");

  const sourceRunId = "64d000000000000000000001";
  state.runs.push({ _id: sourceRunId, status: "COMPLETED", activeLock: "global" });
  const empty = await request("/api/admin/sales-agent/manual-review-runs", jsonOptions("admin", "POST", { sourceRunId }));
  assert.equal(empty.status, 409);
  assert.equal((await empty.json()).code, "NO_MANUAL_REVIEW_RECORDS");
}));

test("manual review resume creates a separate queued trigger with the selected source run", () => withServer(async ({ request, state }) => {
  const sourceRunId = "64d000000000000000000002";
  state.runs.push({ _id: sourceRunId, status: "COMPLETED", activeLock: "global" });
  state.results.push(
    { runId: sourceRunId, resultStatus: "MANUAL_REVIEW" },
    { runId: sourceRunId, resultStatus: "MANUAL_REVIEW" },
    { runId: "64d000000000000000000099", resultStatus: "MANUAL_REVIEW" }
  );
  const response = await request("/api/admin/sales-agent/manual-review-runs", jsonOptions("admin", "POST", { sourceRunId }));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.sourceRunId, sourceRunId);
  assert.equal(body.manualReviewCount, 2);
  assert.equal(body.run.runType, "MANUAL_REVIEW_RESUME");
  assert.equal(body.run.sourceRunId, sourceRunId);
  assert.equal(state.triggerCalls.at(-1).startCommand, "npm run worker:submit-manual-review");
  assert.equal(state.triggerCalls.at(-1).sourceRunId, sourceRunId);
  assert.equal(state.triggerCalls.at(-1).persistedSourceRunId, sourceRunId);

  const duplicate = await request("/api/admin/sales-agent/manual-review-runs", jsonOptions("admin", "POST", { sourceRunId }));
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, "MANUAL_REVIEW_RESUME_ALREADY_ACTIVE");
}));

test("manual review source-run mismatch is rejected before creating a Render job", () => withServer(async ({ request, state }) => {
  const sourceRunId = "64d000000000000000000012";
  state.runs.push({ _id: sourceRunId, status: "COMPLETED", activeLock: "global" });
  state.results.push({ runId: sourceRunId, resultStatus: "MANUAL_REVIEW" });
  const response = await request("/api/admin/sales-agent/manual-review-runs", jsonOptions("admin", "POST", { sourceRunId }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "MANUAL_REVIEW_SOURCE_RUN_MISMATCH");
  assert.equal(state.triggerCalls.length, 0);
}, { persistedSourceRunOverride: "64d000000000000000000013" }));

test("run creation triggers one one-off job and duplicate request does not trigger twice", () => withServer(async ({ request, state }) => {
  const first = await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
  const second = await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal(state.triggerCalls.length, 1);
}));

test("worker trigger failure marks the queued run FAILED", () => withServer(async ({ request, state }) => {
  const response = await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "WORKER_TRIGGER_FAILED");
  assert.equal(state.runs[0].status, "FAILED");
  assert.equal(state.runs[0].failureCode, "WORKER_TRIGGER_FAILED");
  assert.equal(state.runs[0].triggerStatus, "FAILED");
  assert.equal(state.runs[0].failedStage, "RENDER_TRIGGER");
  assert.equal(state.runs[0].failureReason, "Render could not create the Sales Agent job.");
  assert.equal(state.runs[0].errorMessage, "Sales Agent worker could not be started.");
  assert.ok(state.runs[0].failureAt);
}, {
  triggerSalesAgentRun: async () => {
    throw new Error("secret backend details");
  },
}));

test("Render HTTP failure stores redacted upstream diagnostics on the run", () => withServer(async ({ request, state }) => {
  const response = await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "WORKER_TRIGGER_FAILED");
  assert.equal(body.message, "Render API returned 401 Unauthorized: authentication failed");
  assert.equal(state.runs[0].failedStage, "RENDER_TRIGGER");
  assert.equal(state.runs[0].failureCode, "invalid_auth");
  assert.equal(state.runs[0].errorMessage, body.message);
  assert.equal(state.runs[0].failureHttpStatus, 401);
  assert.equal(state.runs[0].failureHttpStatusText, "Unauthorized");
  assert.equal(state.runs[0].upstreamErrorCode, "invalid_auth");
  assert.equal(state.runs[0].upstreamResponseBody, '{"code":"invalid_auth","message":"authentication failed"}');
  assert.equal(new Date(state.runs[0].failureRequestAt).toISOString(), "2026-07-31T12:00:00.000Z");
}, {
  triggerSalesAgentRun: async () => {
    throw new RenderTriggerError("Render API returned 401 Unauthorized: authentication failed", {
      errorCode: "invalid_auth",
      requestTimestamp: "2026-07-31T12:00:00.000Z",
      httpStatus: 401,
      httpStatusText: "Unauthorized",
      responseBody: '{"code":"invalid_auth","message":"authentication failed"}',
      renderErrorCode: "invalid_auth",
      renderErrorMessage: "authentication failed",
    });
  },
}));

test("queued timeout defaults safely to ten minutes", () => {
  assert.equal(queuedTimeoutMs({}), 600000);
  assert.equal(queuedTimeoutMs({ SALES_AGENT_QUEUED_TIMEOUT_MS: "invalid" }), 600000);
});

test("failure stages are supported by the run schema and server logs redact secrets", () => {
  const SalesAgentRun = require("../models/salesAgentRun");
  assert.deepEqual(
    SalesAgentRun.schema.path("failedStage").enumValues,
    ["", "RENDER_TRIGGER", "WORKER_START", "TOGATHER_LOGIN", "DISCOVERY", "OPENAI", "SUBMISSION"]
  );
  const safeLog = redactFailureLog("Error: failed authorization: Bearer token-value api_key=secret-value");
  assert.doesNotMatch(safeLog, /token-value|secret-value/);
  assert.match(safeLog, /\[REDACTED\]/);
});

test("stale queued run fails atomically and a new run can start", () => {
  const currentTime = new Date("2026-07-28T12:00:00.000Z");
  const staleRun = {
    _id: "64c000000000000000000099",
    status: "QUEUED",
    triggerStatus: "TRIGGERED",
    activeLock: "global",
    createdAt: "2026-07-28T11:40:00.000Z",
    updatedAt: "2026-07-28T11:40:00.000Z",
  };
  return withServer(async ({ request, state }) => {
    const response = await request(
      "/api/admin/sales-agent/runs",
      jsonOptions("admin", "POST", {})
    );
    assert.equal(response.status, 201);
    assert.equal(state.runs.length, 2);
    assert.equal(state.runs[0].status, "FAILED");
    assert.equal(state.runs[0].failureCode, "WORKER_NOT_AVAILABLE");
    assert.equal(state.runs[0].triggerStatus, "FAILED");
    assert.equal(state.runs[0].failedStage, "WORKER_START");
    assert.equal(state.runs[0].failureReason, "The worker did not claim the queued run before the timeout.");
    assert.equal(state.runs[0].errorMessage, "Queued run expired before being claimed by a worker.");
    assert.equal(new Date(state.runs[0].failureAt).toISOString(), currentTime.toISOString());
    assert.equal(
      state.runs[0].errorSummary,
      "Queued run expired before being claimed by a worker."
    );
    assert.equal(new Date(state.runs[0].completedAt).toISOString(), currentTime.toISOString());
    assert.equal(state.runs[1].status, "QUEUED");
  }, {
    initialRuns: [staleRun],
    env: { SALES_AGENT_QUEUED_TIMEOUT_MS: "600000" },
    now: () => new Date(currentTime),
  });
});

test("fresh queued run is preserved and a second POST returns 409", () => {
  const currentTime = new Date("2026-07-28T12:00:00.000Z");
  const freshRun = {
    _id: "64c000000000000000000098",
    status: "QUEUED",
    triggerStatus: "TRIGGERED",
    activeLock: "global",
    createdAt: "2026-07-28T11:55:00.000Z",
    updatedAt: "2026-07-28T11:55:00.000Z",
  };
  return withServer(async ({ request, state }) => {
    const response = await request(
      "/api/admin/sales-agent/runs",
      jsonOptions("admin", "POST", {})
    );
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "SALES_AGENT_RUN_ALREADY_ACTIVE");
    assert.equal(state.runs.length, 1);
    assert.equal(state.runs[0].status, "QUEUED");
    assert.equal(state.runs[0].failureCode, undefined);
  }, {
    initialRuns: [freshRun],
    env: { SALES_AGENT_QUEUED_TIMEOUT_MS: "600000" },
    now: () => new Date(currentTime),
  });
});

test("status keeps fresh QUEUED and RUNNING runs active", async () => {
  const currentTime = new Date("2026-07-28T12:00:00.000Z");
  for (const status of ["QUEUED", "RUNNING"]) {
    await withServer(async ({ request, state }) => {
      const response = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
      const body = await response.json();
      assert.equal(body.status, status);
      assert.equal(body.run.status, status);
      assert.equal(state.runs[0].status, status);
    }, {
      initialRuns: [{
        _id: `64c0000000000000000000${status === "QUEUED" ? "81" : "82"}`,
        status,
        activeLock: "global",
        createdAt: "2026-07-28T11:55:00.000Z",
        updatedAt: "2026-07-28T11:55:00.000Z",
      }],
      env: { SALES_AGENT_QUEUED_TIMEOUT_MS: "600000" },
      now: () => new Date(currentTime),
    });
  }
});

test("status atomically recovers stale QUEUED run and reports IDLE", () => {
  const currentTime = new Date("2026-07-28T12:00:00.000Z");
  return withServer(async ({ request, state }) => {
    const response = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
    const body = await response.json();
    assert.equal(body.status, "IDLE");
    assert.equal(body.run, null);
    assert.equal(state.runs[0].status, "FAILED");
    assert.equal(state.runs[0].failureCode, "WORKER_NOT_AVAILABLE");
    assert.equal(state.runs[0].errorSummary, "Queued run expired before being claimed by a worker.");
    assert.equal(state.runs[0].failedStage, "WORKER_START");
    assert.equal(state.runs[0].failureReason, "The worker did not claim the queued run before the timeout.");
    assert.equal(state.runs[0].errorMessage, "Queued run expired before being claimed by a worker.");
    assert.equal(new Date(state.runs[0].failureAt).toISOString(), currentTime.toISOString());
  }, {
    initialRuns: [{
      _id: "64c000000000000000000083",
      status: "QUEUED",
      activeLock: "global",
      createdAt: "2026-07-28T11:40:00.000Z",
      updatedAt: "2026-07-28T11:40:00.000Z",
    }],
    env: { SALES_AGENT_QUEUED_TIMEOUT_MS: "600000" },
    now: () => new Date(currentTime),
  });
});

test("completed and failed runs report IDLE and allow a new run", async () => {
  for (const status of ["COMPLETED", "FAILED"]) {
    await withServer(async ({ request, state }) => {
      const statusResponse = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
      assert.equal((await statusResponse.json()).status, "IDLE");
      const createResponse = await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
      assert.equal(createResponse.status, 201);
      assert.equal(state.runs.filter((run) => ["QUEUED", "RUNNING"].includes(run.status)).length, 1);
    }, {
      initialRuns: [{
        _id: `64c0000000000000000000${status === "COMPLETED" ? "84" : "85"}`,
        status,
        activeLock: "global",
        createdAt: "2026-07-28T11:00:00.000Z",
        updatedAt: "2026-07-28T11:00:00.000Z",
      }],
    });
  }
});

test("concurrent creates after stale recovery produce only one active run", () => {
  const currentTime = new Date("2026-07-28T12:00:00.000Z");
  return withServer(async ({ request, state }) => {
    const responses = await Promise.all([
      request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {})),
      request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {})),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    assert.equal(state.runs[0].status, "FAILED");
    assert.equal(state.runs.filter((run) => ["QUEUED", "RUNNING"].includes(run.status)).length, 1);
  }, {
    initialRuns: [{
      _id: "64c000000000000000000086",
      status: "QUEUED",
      activeLock: "global",
      createdAt: "2026-07-28T11:40:00.000Z",
      updatedAt: "2026-07-28T11:40:00.000Z",
    }],
    env: { SALES_AGENT_QUEUED_TIMEOUT_MS: "600000" },
    now: () => new Date(currentTime),
  });
});

test("Super Admin can create a queued Sales Agent run", () => withServer(async ({ request }) => {
  const response = await request("/api/admin/sales-agent/runs", jsonOptions("superadmin", "POST", {}));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.run.triggeredByRole, "superadmin");
}));

test("Normal user cannot access Sales Agent Admin endpoints", () => withServer(async ({ request }) => {
  const response = await request("/api/admin/sales-agent/runs", jsonOptions("user", "POST", {}));
  assert.equal(response.status, 401);
}));

test("Second active run returns the required 409 code", () => withServer(async ({ request }) => {
  await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
  const response = await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "SALES_AGENT_RUN_ALREADY_ACTIVE");
}));

test("Run list, detail and result list are readable", () => withServer(async ({ request, state }) => {
  const created = await (await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}))).json();
  state.results.push({ runId: created.run._id, opportunityId: "TEST1", platform: "togather" });

  const list = await (await request("/api/admin/sales-agent/runs", jsonOptions("admin"))).json();
  assert.equal(list.runs.length, 1);

  const detailResponse = await request(`/api/admin/sales-agent/runs/${created.run._id}`, jsonOptions("admin"));
  assert.equal(detailResponse.status, 200);

  const results = await (await request(`/api/admin/sales-agent/runs/${created.run._id}/results`, jsonOptions("admin"))).json();
  assert.equal(results.results[0].opportunityId, "TEST1");
}));

test("Invalid runId is rejected", () => withServer(async ({ request }) => {
  const response = await request("/api/admin/sales-agent/runs/not-an-id", jsonOptions("admin"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_RUN_ID");
}));

test("Settings are restricted to Super Admin", () => withServer(async ({ request }) => {
  const adminResponse = await request("/api/superadmin/sales-agent/settings", jsonOptions("admin"));
  assert.equal(adminResponse.status, 403);
  const superResponse = await request("/api/superadmin/sales-agent/settings", jsonOptions("superadmin"));
  assert.equal(superResponse.status, 200);
}));

test("Settings update accepts only whitelisted fields", () => withServer(async ({ request }) => {
  const response = await request(
    "/api/superadmin/sales-agent/settings",
    jsonOptions("superadmin", "PATCH", { autoRunEnabled: true, secretKey: "refused" })
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /Unknown settings fields/);
}));

test("Negative settings limits are rejected", () => withServer(async ({ request }) => {
  const response = await request(
    "/api/superadmin/sales-agent/settings",
    jsonOptions("superadmin", "PATCH", { maxOpenAiCallsPerRun: -1 })
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /non-negative integer/);
}));

test("Super Admin can update whitelisted settings", () => withServer(async ({ request }) => {
  const response = await request(
    "/api/superadmin/sales-agent/settings",
    jsonOptions("superadmin", "PATCH", {
      autoRunEnabled: true,
      autoSubmitEnabled: false,
      maxOpenAiCallsPerRun: 3,
      maxOpenAiCallsPerDay: 10,
    })
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.settings.maxOpenAiCallsPerDay, 10);
}));

test("canonical latest overlay promotes submitted state without altering historical input", () => {
  const historical = [{
    platform: "togather",
    opportunityId: "RUYN9WR7",
    resultStatus: "MANUAL_REVIEW",
    blockingReasons: ["Timings missing"],
    quoteSubmitted: false,
    quoteUuid: "",
    updatedAt: "2026-07-26T10:00:00.000Z",
  }];
  const latest = {
    ...historical[0],
    resultStatus: "SUBMITTED",
    platformState: "pending",
    quoteSubmitted: true,
    quoteUuid: "1677448a-d2ba-4512-8f13-dacdfaafdbec",
    blockingReasons: [],
    updatedAt: "2026-07-27T10:00:00.000Z",
  };
  const result = overlayCanonicalLatest(historical, [historical[0], latest]);
  assert.equal(result[0].resultStatus, "PENDING");
  assert.equal(result[0].quoteUuid, latest.quoteUuid);
  assert.deepEqual(result[0].blockingReasons, []);
  assert.equal(historical[0].resultStatus, "MANUAL_REVIEW");
});

test("verified canonical fields overlay the same historical result without rewriting history", () => {
  const historical = [{
    platform: "togather",
    opportunityId: "RUYN9WR7",
    resultStatus: "MANUAL_REVIEW",
    blockingReasons: ["Old historical review reason"],
    quoteSubmitted: false,
    quoteUuid: "",
    verifiedStatus: "PENDING",
    verifiedPlatformState: "pending",
    verifiedQuoteUuid: "1677448a-d2ba-4512-8f13-dacdfaafdbec",
  }];
  const latest = overlayCanonicalLatest(historical, historical);
  assert.equal(latest[0].resultStatus, "PENDING");
  assert.equal(latest[0].quoteUuid, historical[0].verifiedQuoteUuid);
  assert.deepEqual(latest[0].blockingReasons, []);
  assert.equal(historical[0].resultStatus, "MANUAL_REVIEW");
  assert.deepEqual(historical[0].blockingReasons, ["Old historical review reason"]);
});

test("canonical precedence keeps accepted above pending and pending above older failed", () => {
  const base = [{ platform: "togather", opportunityId: "TEST", resultStatus: "FAILED" }];
  const pending = {
    platform: "togather", opportunityId: "TEST", resultStatus: "SUBMITTED",
    platformState: "pending", quoteSubmitted: true, quoteUuid: "quote-1",
  };
  const accepted = {
    ...pending, resultStatus: "ACCEPTED", platformState: "accepted", quoteUuid: "quote-1",
  };
  assert.equal(overlayCanonicalLatest(base, [pending, accepted])[0].resultStatus, "ACCEPTED");
  assert.equal(overlayCanonicalLatest(base, [pending, { ...base[0], updatedAt: new Date().toISOString() }])[0].resultStatus, "PENDING");
});
