const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { RenderTriggerError } = require("../services/salesAgentJobTrigger");

const {
  createSalesAgentRouter,
  overlayCanonicalLatest,
  queuedTimeoutMs,
  workerStartGraceMs,
  buildActiveRunDiagnostics,
  workerDiagnosticReason,
  redactFailureLog,
  opportunitySelectionPolicy,
} = require("../routes/salesAgentRoutes");

const ADMIN_ID = "64b000000000000000000001";
const SUPERADMIN_ID = "64b000000000000000000002";
const fixedApiNow = () => new Date("2026-07-31T12:00:00.000Z");

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
  getRenderJobStatus,
  cancelRenderJob,
  initialRuns = [],
  env = {},
  now = () => new Date(),
  persistedSourceRunOverride = "",
  logger = { error() {} },
} = {}) {
  const state = {
    runs: structuredClone(initialRuns),
    results: [],
    settings: null,
    sequence: initialRuns.length + 1,
    triggerCalls: [],
    persistedReadIds: [],
  };
  const trigger = triggerSalesAgentRun || (async (input) => {
    state.triggerCalls.push({ ...input, persistedReadIds: [...state.persistedReadIds] });
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
      state.persistedReadIds.push(String(id));
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
        if (filter._id && String(item._id) !== String(filter._id)) return false;
        if (filter.status?.$in && !filter.status.$in.includes(item.status)) return false;
        if (typeof filter.status === "string" && item.status !== filter.status) return false;
        if (cutoff instanceof Date) {
          const timestamp = item.updatedAt || item.createdAt;
          return new Date(timestamp) < cutoff;
        }
        return true;
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
        String(result.runId) === String(filter.runId)
          && (!filter.resultStatus || result.resultStatus === filter.resultStatus)
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
    findById(id) {
      return query(state.results.find((result) => String(result._id) === String(id)) || null);
    },
    findOneAndUpdate(filter, update) {
      const result = state.results.find((item) =>
        String(item._id) === String(filter._id) && Number(item.recordVersion) === Number(filter.recordVersion)
      );
      if (!result) return query(null);
      for (const [path, value] of Object.entries(update.$set || {})) {
        const parts = path.split(".");
        let target = result;
        for (const part of parts.slice(0, -1)) target = target[part] ||= {};
        target[parts.at(-1)] = structuredClone(value);
      }
      for (const [key, value] of Object.entries(update.$inc || {})) result[key] = Number(result[key] || 0) + value;
      return query(result);
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
    getRenderJobStatus: getRenderJobStatus || (async () => ({ status: "running", checkedAt: now().toISOString() })),
    cancelRenderJob: cancelRenderJob || (async () => ({ status: "canceled", checkedAt: now().toISOString(), finishedAt: now().toISOString() })),
    env,
    now,
    logger,
  }));
  return { app, state };
}

test("status reconciles a canceled Render job, releases the lock, and preserves partial results", () => {
  const runId = "64c000000000000000000091";
  return withServer(async ({ request, state }) => {
    state.results.push({ _id: "result-1", runId, opportunityId: "PARTIAL-1", resultStatus: "QUOTE_READY" });
    const response = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
    const body = await response.json();
    assert.equal(body.run.status, "CANCELED");
    assert.equal(body.run.failureCode, "RENDER_JOB_CANCELED");
    assert.equal(body.run.persistedResultCount, 1);
    assert.equal(body.run.partialResultCount, 1);
    assert.equal(body.run.partialResultsAvailable, true);
    assert.match(body.run.activeLock, /^released:/);
    assert.equal(state.results[0].opportunityId, "PARTIAL-1");
  }, {
    initialRuns: [{
      _id: runId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global",
      triggerJobId: "job-canceled", renderJobId: "job-canceled", renderServiceId: "srv-test",
      createdAt: "2026-07-31T10:00:00.000Z", updatedAt: "2026-07-31T11:00:00.000Z",
    }],
    now: fixedApiNow,
    getRenderJobStatus: async () => ({ status: "canceled", checkedAt: fixedApiNow().toISOString(), finishedAt: fixedApiNow().toISOString() }),
  });
});

test("failed run API preserves checkpoint metadata and reports partial results", () => {
  const runId = "64c000000000000000000092";
  return withServer(async ({ request, state }) => {
    state.results.push({ _id: "result-checkpoint", runId, opportunityId: "CHECKPOINT-1", resultStatus: "DISCOVERED" });
    const response = await request(`/api/admin/sales-agent/runs/${runId}`, jsonOptions("admin"));
    const body = await response.json();
    assert.equal(body.run.status, "FAILED");
    assert.equal(body.run.partialResultsAvailable, true);
    assert.equal(body.run.partialResultCount, 1);
    assert.equal(body.run.lastCheckpointPage, 4);
    assert.equal(body.run.lastCheckpointAt, "2026-07-31T11:05:00.000Z");
  }, {
    initialRuns: [{
      _id: runId, runType: "DISCOVERY", status: "FAILED", activeLock: `released:${runId}`,
      lastCheckpointPage: 4, lastCheckpointAt: "2026-07-31T11:05:00.000Z",
      createdAt: "2026-07-31T10:00:00.000Z", updatedAt: "2026-07-31T11:05:00.000Z",
    }],
    now: fixedApiNow,
  });
});

test("manual reconciliation is idempotent and does not run a worker", () => {
  const runId = "64c000000000000000000092";
  let checks = 0;
  return withServer(async ({ request, state }) => {
    const first = await request(`/api/admin/sales-agent/runs/${runId}/reconcile`, jsonOptions("superadmin", "POST", {}));
    const firstBody = await first.json();
    assert.equal(firstBody.run.status, "FAILED");
    assert.deepEqual(firstBody.reconciliation, {
      previousStatus: "RUNNING",
      newStatus: "FAILED",
      lockReleased: true,
      preservedResultCount: 0,
      reconciliationReason: "RENDER_JOB_FAILED",
    });
    const second = await request(`/api/admin/sales-agent/runs/${runId}/reconcile`, jsonOptions("admin", "POST", {}));
    const secondBody = await second.json();
    assert.equal(secondBody.run.status, "FAILED");
    assert.equal(secondBody.reconciliation.lockReleased, false);
    assert.equal(checks, 1);
    assert.equal(state.triggerCalls.length, 0);
  }, {
    initialRuns: [{
      _id: runId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global",
      triggerJobId: "job-failed", createdAt: "2026-07-31T10:00:00.000Z",
    }],
    getRenderJobStatus: async () => { checks += 1; return { status: "failed", checkedAt: fixedApiNow().toISOString() }; },
    now: fixedApiNow,
  });
});

test("Render running metadata does not claim a QUEUED run on behalf of the worker", () => {
  const runId = "64c00000000000000000009a";
  return withServer(async ({ request, state }) => {
    const response = await request(`/api/admin/sales-agent/runs/${runId}/reconcile`, jsonOptions("admin", "POST", {}));
    const body = await response.json();
    assert.equal(body.run.status, "QUEUED");
    assert.equal(body.run.renderJobStatus, "running");
    assert.equal(body.reconciliation.newStatus, "QUEUED");
    assert.equal(state.runs[0].workerId, undefined);
  }, {
    initialRuns: [{ _id: runId, runType: "DISCOVERY", status: "QUEUED", activeLock: "global", renderJobId: "job-running" }],
    getRenderJobStatus: async () => ({ status: "running", checkedAt: fixedApiNow().toISOString() }),
    now: fixedApiNow,
  });
});

test("reconcile repairs a terminal run lock without overwriting terminal status or results", () => {
  const runId = "64c00000000000000000009b";
  return withServer(async ({ request, state }) => {
    state.results.push({ _id: "terminal-result", runId, opportunityId: "DONE", resultStatus: "SUBMITTED" });
    const response = await request(`/api/admin/sales-agent/runs/${runId}/reconcile`, jsonOptions("admin", "POST", {}));
    const body = await response.json();
    assert.equal(body.run.status, "COMPLETED");
    assert.match(body.run.activeLock, /^released:/);
    assert.ok(body.run.finishedAt);
    assert.equal(body.reconciliation.preservedResultCount, 1);
    assert.equal(body.reconciliation.lockReleased, true);
    assert.equal(state.results[0].opportunityId, "DONE");
  }, {
    initialRuns: [{ _id: runId, runType: "DISCOVERY", status: "COMPLETED", activeLock: "global", completedAt: fixedApiNow().toISOString() }],
    now: fixedApiNow,
  });
});

test("Render timeout leaves RUNNING unchanged and a missing job waits for stale threshold", async () => {
  const freshId = "64c000000000000000000093";
  await withServer(async ({ request, state }) => {
    const response = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
    assert.equal((await response.json()).run.status, "RUNNING");
    assert.equal(state.runs[0].activeLock, "global");
  }, {
    initialRuns: [{ _id: freshId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global", triggerJobId: "job-timeout", createdAt: fixedApiNow().toISOString() }],
    getRenderJobStatus: async () => ({ timedOut: true }), now: fixedApiNow,
  });
  await withServer(async ({ request }) => {
    const response = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
    assert.equal((await response.json()).run.status, "RUNNING");
  }, {
    initialRuns: [{ _id: freshId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global", triggerJobId: "job-missing", createdAt: fixedApiNow().toISOString() }],
    getRenderJobStatus: async () => ({ missing: true, checkedAt: fixedApiNow().toISOString() }), now: fixedApiNow,
    env: { SALES_AGENT_QUEUED_TIMEOUT_MS: "600000" },
  });
});

test("a stale missing Render job is recovered as FAILED", () => {
  const runId = "64c000000000000000000094";
  return withServer(async ({ request }) => {
    const response = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
    const body = await response.json();
    assert.equal(body.run.status, "FAILED");
    assert.equal(body.run.failureCode, "RENDER_JOB_MISSING");
  }, {
    initialRuns: [{ _id: runId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global", triggerJobId: "job-missing", createdAt: "2026-07-31T10:00:00.000Z" }],
    getRenderJobStatus: async () => ({ missing: true, checkedAt: fixedApiNow().toISOString() }), now: fixedApiNow,
    env: { SALES_AGENT_QUEUED_TIMEOUT_MS: "600000" },
  });
});

test("cancel endpoint confirms Render cancellation, releases only the run lock, and preserves counters/results", () => {
  const runId = "64c000000000000000000095";
  let cancelCalls = 0;
  return withServer(async ({ request, state }) => {
    state.results.push({ _id: "saved-result", runId, opportunityId: "SAVED", resultStatus: "QUOTE_READY" });
    const response = await request(`/api/admin/sales-agent/runs/${runId}/cancel`, jsonOptions("admin", "POST", {}));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.run.status, "CANCELED");
    assert.equal(body.run.renderJobStatus, "canceled");
    assert.equal(body.run.totals.opportunitiesFound, 7);
    assert.equal(body.run.persistedResultCount, 1);
    assert.match(body.run.activeLock, /^released:/);
    assert.equal(state.results[0].opportunityId, "SAVED");
    assert.equal(cancelCalls, 1);
    const duplicate = await request(`/api/admin/sales-agent/runs/${runId}/cancel`, jsonOptions("superadmin", "POST", {}));
    assert.equal((await duplicate.json()).idempotent, true);
    assert.equal(cancelCalls, 1);
  }, {
    initialRuns: [{
      _id: runId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global",
      triggerJobId: "job-running", renderJobId: "job-running", renderServiceId: "srv-test",
      totals: { opportunitiesFound: 7, quotesSubmitted: 2 }, createdAt: "2026-07-31T10:00:00.000Z",
    }],
    getRenderJobStatus: async () => ({ status: "running", checkedAt: fixedApiNow().toISOString() }),
    cancelRenderJob: async () => { cancelCalls += 1; return { status: "canceled", checkedAt: fixedApiNow().toISOString(), finishedAt: fixedApiNow().toISOString() }; },
    now: fixedApiNow,
  });
});

test("cancel endpoint validates authorization, run ID, and active status", async () => {
  const completedId = "64c000000000000000000096";
  await withServer(async ({ request }) => {
    assert.equal((await request(`/api/admin/sales-agent/runs/${completedId}/cancel`, jsonOptions("user", "POST", {}))).status, 401);
    assert.equal((await request("/api/admin/sales-agent/runs/not-an-id/cancel", jsonOptions("admin", "POST", {}))).status, 400);
    const completed = await request(`/api/admin/sales-agent/runs/${completedId}/cancel`, jsonOptions("admin", "POST", {}));
    assert.equal(completed.status, 409);
    assert.equal((await completed.json()).code, "SALES_AGENT_RUN_NOT_ACTIVE");
  }, { initialRuns: [{ _id: completedId, runType: "DISCOVERY", status: "COMPLETED", activeLock: "global" }] });
});

test("cancel reconciles an already-terminal Render job without sending cancel", () => {
  const runId = "64c000000000000000000097";
  let cancelCalls = 0;
  return withServer(async ({ request }) => {
    const response = await request(`/api/admin/sales-agent/runs/${runId}/cancel`, jsonOptions("admin", "POST", {}));
    const body = await response.json();
    assert.equal(body.alreadyTerminal, true);
    assert.equal(body.run.status, "FAILED");
    assert.equal(body.run.failureCode, "NO_QUEUED_RUN");
    assert.match(body.run.errorMessage, /NO_QUEUED_RUN.*activeRunCount=1.*queuedCount=0/);
    assert.equal(cancelCalls, 0);
  }, {
    initialRuns: [{ _id: runId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global", triggerJobId: "job-done", renderServiceId: "srv-test" }],
    getRenderJobStatus: async () => ({ status: "succeeded", checkedAt: fixedApiNow().toISOString() }),
    cancelRenderJob: async () => { cancelCalls += 1; }, now: fixedApiNow,
  });
});

test("active-run diagnostics explain why a run remains active without exposing secrets", () => {
  const diagnostic = buildActiveRunDiagnostics([{
    _id: "run-1", status: "RUNNING", activeLock: "global",
    createdAt: "2026-07-31T11:55:00.000Z", updatedAt: "2026-07-31T11:59:00.000Z",
    renderJobId: "job-1", renderJobStatus: "succeeded",
  }], { currentTime: fixedApiNow(), env: { SALES_AGENT_WORKER_START_GRACE_MS: "30000" }, render: { status: "succeeded" } });
  assert.equal(diagnostic.queuedCount, 0);
  assert.equal(diagnostic.activeRunCount, 1);
  assert.deepEqual(diagnostic.activeRunIds[0].activeReasons, [
    "status RUNNING", "lock not released", "waiting for reconciliation",
  ]);
  assert.equal(diagnostic.activeRunIds[0].ageSeconds, 60);
  assert.equal(diagnostic.activeRunIds[0].actuallyTerminal, true);
  assert.equal(diagnostic.activeRunIds[0].expected, false);
  assert.equal(diagnostic.activeRunIds[0].reconciliationShouldAlreadyHaveCompleted, true);
  assert.equal(JSON.stringify(diagnostic).includes("mongodb"), false);
});

test("worker no-queue reason has precedence and structured active diagnostic is logged", () => {
  const runId = "64c000000000000000000087";
  const lines = [];
  const exactReason = "NO_QUEUED_RUN: queuedCount=0 activeRunCount=1 exclusion=RUNNING";
  return withServer(async ({ request }) => {
    const response = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
    const body = await response.json();
    assert.equal(body.run.failureReason, exactReason);
    assert.equal(body.run.errorMessage, exactReason);
    assert.ok(lines.some((line) => line.startsWith("SALES_AGENT_QUEUE_DIAGNOSTICS ")));
    assert.ok(lines.some((line) => line.startsWith("SALES_AGENT_ACTIVE_RUN_DIAGNOSTICS ")));
  }, {
    initialRuns: [{
      _id: runId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global",
      createdAt: "2026-07-31T11:50:00.000Z", updatedAt: "2026-07-31T11:58:00.000Z",
      renderJobId: "job-done", renderJobStatus: "succeeded", errorMessage: exactReason,
    }],
    now: fixedApiNow,
    getRenderJobStatus: async () => ({ status: "succeeded", checkedAt: fixedApiNow().toISOString() }),
    logger: { error() {}, info(value) { lines.push(String(value)); } },
  });
});

test("worker diagnostic reason helper ignores the former generic Render message", () => {
  assert.equal(workerDiagnosticReason({ errorMessage: "Render succeeded but the Sales Agent workflow did not record completion." }), "");
  assert.equal(workerDiagnosticReason({ workerDiagnostic: { errorMessage: "No queued Sales Agent run." } }), "No queued Sales Agent run.");
});

test("cancel timeout leaves the local run unchanged", () => {
  const runId = "64c000000000000000000098";
  return withServer(async ({ request, state }) => {
    const response = await request(`/api/admin/sales-agent/runs/${runId}/cancel`, jsonOptions("admin", "POST", {}));
    assert.equal(response.status, 503);
    assert.equal(state.runs[0].status, "RUNNING");
    assert.equal(state.runs[0].activeLock, "global");
  }, {
    initialRuns: [{ _id: runId, runType: "DISCOVERY", status: "RUNNING", activeLock: "global", triggerJobId: "job-timeout", renderServiceId: "srv-test" }],
    getRenderJobStatus: async () => ({ status: "running", checkedAt: fixedApiNow().toISOString() }),
    cancelRenderJob: async () => ({ timedOut: true }), now: fixedApiNow,
  });
});

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

test("canonical queued run is read back before Render trigger and keeps one identity", () => withServer(async ({ request, state }) => {
  const response = await request("/api/admin/sales-agent/runs", jsonOptions("admin", "POST", {}));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(state.triggerCalls.length, 1);
  assert.equal(state.triggerCalls[0].runId, body.run._id);
  assert.deepEqual(state.triggerCalls[0].persistedReadIds, [body.run._id]);
  assert.equal(body.run.runType, "DISCOVERY");
  assert.equal(body.run.status, "QUEUED");
  assert.equal(body.run.activeLock, "global");
  assert.equal(body.run.origin, "ADMIN_DASHBOARD");
  assert.ok(body.run.queuedAt);
  assert.equal(body.run.renderJobId, "job-1");
}));

test("fresh QUEUED run is protected when Render reports succeeded during worker-start grace", () => {
  const runId = "64c000000000000000000088";
  return withServer(async ({ request, state }) => {
    const response = await request("/api/admin/sales-agent/status", jsonOptions("admin"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.run.status, "QUEUED");
    assert.equal(state.runs[0].activeLock, "global");
  }, {
    initialRuns: [{
      _id: runId, runType: "DISCOVERY", status: "QUEUED", activeLock: "global",
      queuedAt: "2026-07-31T11:59:30.000Z", createdAt: "2026-07-31T11:59:30.000Z",
      renderJobId: "job-fresh", renderServiceId: "srv-test",
    }],
    env: { SALES_AGENT_WORKER_START_GRACE_MS: "120000" }, now: fixedApiNow,
    getRenderJobStatus: async () => ({ status: "succeeded", checkedAt: fixedApiNow().toISOString() }),
  });
});

const eligibleAddToEvent = (overrides = {}) => ({
  _id: "64f000000000000000000001",
  runId: "64d000000000000000000001",
  platform: "addtoevent",
  opportunityId: "ATE-1",
  approvalStatus: "READY",
  manualApprovalRequired: true,
  manualSubmissionEligible: true,
  recordVersion: 1,
  finalPrice: 500,
  platformCostEstimate: { unit: "CREDITS", status: "KNOWN", amount: 8 },
  quoteSnapshot: { calculatedPrice: 500, estimatedRevenue: 500, estimatedProfit: 150 },
  manualOverrides: {},
  resultStatus: "READY",
  ...overrides,
});

test("manual selection policy blocks Togather and terminal or unavailable opportunities", () => {
  assert.equal(opportunitySelectionPolicy(eligibleAddToEvent()).manualSelectionEligible, true);
  assert.equal(opportunitySelectionPolicy(eligibleAddToEvent({ approvalStatus: "NOT_REVIEWED" })).manualSelectionEligible, true);
  assert.equal(opportunitySelectionPolicy(eligibleAddToEvent({ platform: "togather" })).manualSelectionBlocker, "TOGATHER_AUTOMATIC_POLICY");
  assert.equal(opportunitySelectionPolicy(eligibleAddToEvent({ quoteSubmitted: true })).manualSelectionEligible, false);
  assert.equal(opportunitySelectionPolicy(eligibleAddToEvent({ resultStatus: "ALREADY_QUOTED" })).manualSelectionBlocker, "ALREADY_QUOTED");
  assert.equal(opportunitySelectionPolicy(eligibleAddToEvent({ approvalStatus: "REJECTED" })).manualSelectionEligible, false);
  assert.equal(opportunitySelectionPolicy(eligibleAddToEvent({ unavailable: true })).manualSelectionBlocker, "UNAVAILABLE");
  assert.equal(opportunitySelectionPolicy(eligibleAddToEvent({ expiresAt: "2000-01-01T00:00:00.000Z" })).manualSelectionBlocker, "EXPIRED");
});

test("failed Add to Event submissions without a platform action release selection while verified quotes stay protected", () => withServer(async ({ request, state }) => {
  const sourceRunId = "64d000000000000000000001";
  const failedRunId = "64c000000000000000000099";
  state.runs.push({
    _id: sourceRunId, runType: "DISCOVERY", status: "COMPLETED", activeLock: `released:${sourceRunId}`,
  }, {
    _id: failedRunId, runType: "ADD_TO_EVENT_SUBMISSION", status: "COMPLETED", activeLock: `released:${failedRunId}`,
    totals: { opportunitiesFound: 1, quotesSubmitted: 0, failed: 1, platformActions: 0 },
  });
  state.results.push(
    eligibleAddToEvent({ submissionLock: { runId: failedRunId }, selectedVersion: 1 }),
    eligibleAddToEvent({
      _id: "64f000000000000000000002", opportunityId: "ATE-VERIFIED", submissionLock: { runId: failedRunId },
      selectedVersion: 1, quoteSubmitted: true, verifiedQuoteUuid: "verified-quote",
    })
  );

  const response = await request(`/api/admin/sales-agent/runs/${sourceRunId}/results`, jsonOptions("admin"));
  const body = await response.json();

  assert.equal(body.results[0].manualSelectionEligible, true);
  assert.equal(state.results[0].submissionLock, null);
  assert.equal(state.results[0].selectedVersion, null);
  assert.equal(body.results[1].manualSelectionEligible, false);
  assert.deepEqual(state.results[1].submissionLock, { runId: failedRunId });
  assert.equal(state.triggerCalls.length, 0);
}));

test("opportunity edit requires exact ID/version, rejects operators, and increments atomically", () => withServer(async ({ request, state }) => {
  state.results.push(eligibleAddToEvent());
  const invalid = await request("/api/admin/sales-agent/opportunities/bad", jsonOptions("admin", "PATCH", { expectedVersion: 1, finalPrice: 450 }));
  assert.equal(invalid.status, 400);
  const missingVersion = await request("/api/admin/sales-agent/opportunities/64f000000000000000000001", jsonOptions("admin", "PATCH", { finalPrice: 450 }));
  assert.equal((await missingVersion.json()).code, "EXPECTED_VERSION_REQUIRED");
  const operator = await request("/api/admin/sales-agent/opportunities/64f000000000000000000001", jsonOptions("admin", "PATCH", { expectedVersion: 1, $set: { finalPrice: 1 } }));
  assert.equal((await operator.json()).code, "EDITABLE_FIELD_NOT_ALLOWED");
  const saved = await request("/api/admin/sales-agent/opportunities/64f000000000000000000001", jsonOptions("admin", "PATCH", { expectedVersion: 1, finalPrice: 450, discountReason: "Price match" }));
  const savedBody = await saved.json();
  assert.equal(saved.status, 200);
  assert.equal(savedBody.opportunity.recordVersion, 2);
  assert.equal(savedBody.opportunity.manualOverrides.finalPrice, 450);
  assert.equal(savedBody.opportunity.approvalStatus, "NOT_REVIEWED");
  const stale = await request("/api/admin/sales-agent/opportunities/64f000000000000000000001", jsonOptions("admin", "PATCH", { expectedVersion: 1, finalPrice: 400 }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "OPPORTUNITY_VERSION_CONFLICT");
}));

test("manual Add to Event quote override resolves review and becomes selectable at the new version", () => withServer(async ({ request, state }) => {
  state.results.push(eligibleAddToEvent({
    resultStatus: "MANUAL_REVIEW",
    analysisStatus: "MANUAL_REVIEW",
    approvalStatus: "NEEDS_REVIEW",
    blockingReasons: ["RELIABLE_PRICE_UNAVAILABLE"],
    reviewCodes: ["UNSUPPORTED_ROLE"],
    selectedVersion: 1,
  }));

  const response = await request(
    "/api/admin/sales-agent/opportunities/64f000000000000000000001",
    jsonOptions("admin", "PATCH", {
      expectedVersion: 1,
      saveAndApprove: true,
      staffBreakdown: [{ role: "Bartender", quantity: 2 }],
      durationHours: 6,
      travelCharge: 45,
      finalPrice: 575,
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.opportunity.resultStatus, "READY");
  assert.equal(body.opportunity.analysisStatus, "QUOTE_READY");
  assert.equal(body.opportunity.approvalStatus, "APPROVED");
  assert.equal(body.opportunity.recordVersion, 2);
  assert.equal(body.opportunity.selectedVersion, null);
  assert.equal(body.opportunity.manualOverrideApplied, true);
  assert.equal(body.opportunity.manualOverrides.durationHours, 6);
  assert.equal(body.opportunity.manualOverrides.travelCharge, 45);
  assert.equal(body.opportunity.manualOverrides.finalPrice, 575);
  assert.deepEqual(body.opportunity.blockingReasons, []);
  assert.deepEqual(body.opportunity.reviewCodes, []);
  assert.deepEqual(body.opportunity.resolvedBlockingReasons, ["RELIABLE_PRICE_UNAVAILABLE"]);
  assert.deepEqual(body.opportunity.resolvedReviewCodes, ["UNSUPPORTED_ROLE"]);
  assert.equal(body.opportunity.manualSelectionEligible, true);
  assert.equal(state.triggerCalls.length, 0);
}));

test("bulk selection rejects duplicate IDs and Togather while updating eligible Add to Event records", () => withServer(async ({ request, state }) => {
  const addToEvent = eligibleAddToEvent();
  const togather = eligibleAddToEvent({ _id: "64f000000000000000000002", platform: "togather", opportunityId: "TOG-1" });
  state.results.push(addToEvent, togather);
  const duplicate = await request("/api/admin/sales-agent/opportunities/bulk-status", jsonOptions("admin", "POST", {
    records: [{ id: addToEvent._id, expectedVersion: 1 }, { id: addToEvent._id, expectedVersion: 1 }], targetStatus: "HOLD",
  }));
  assert.equal((await duplicate.json()).code, "DUPLICATE_OPPORTUNITY_ID");
  const mixed = await request("/api/admin/sales-agent/opportunities/bulk-status", jsonOptions("admin", "POST", {
    records: [{ id: addToEvent._id, expectedVersion: 1 }, { id: togather._id, expectedVersion: 1 }], targetStatus: "HOLD",
  }));
  const body = await mixed.json();
  assert.equal(body.outcomes[0].success, true);
  assert.equal(body.outcomes[0].opportunity.approvalStatus, "HOLD");
  assert.equal(body.outcomes[0].opportunity.recordVersion, 2);
  assert.equal(body.outcomes[1].success, false);
  assert.equal(body.outcomes[1].code, "TOGATHER_AUTOMATIC_POLICY");
  assert.equal(state.triggerCalls.length, 0);
}));

test("selection preview is exact, versioned, and performs no worker or platform action", () => withServer(async ({ request, state }) => {
  state.results.push(
    eligibleAddToEvent(),
    eligibleAddToEvent({ _id: "64f000000000000000000003", opportunityId: "ATE-2", finalPrice: 250, quoteSnapshot: { calculatedPrice: 250, estimatedRevenue: 250, estimatedProfit: 50 } }),
    eligibleAddToEvent({ _id: "64f000000000000000000004", opportunityId: "ATE-3", unavailable: true })
  );
  const response = await request("/api/admin/sales-agent/opportunities/selection-preview", jsonOptions("admin", "POST", {
    records: [
      { id: "64f000000000000000000001", expectedVersion: 1 },
      { id: "64f000000000000000000003", expectedVersion: 1 },
      { id: "64f000000000000000000004", expectedVersion: 1 },
    ],
  }));
  const body = await response.json();
  assert.equal(body.preview.selectedCount, 2);
  assert.deepEqual(body.preview.opportunityIds, ["ATE-1", "ATE-2"]);
  assert.equal(body.preview.combinedQuotationValue, 750);
  assert.equal(body.preview.records[0].finalPrice, 500);
  assert.deepEqual(body.preview.records[0].platformCostEstimate, { unit: "CREDITS", status: "KNOWN", amount: 8 });
  assert.equal(body.preview.estimatedProfit, 200);
  assert.equal(body.preview.blocked[0].code, "UNAVAILABLE");
  assert.equal(body.preview.noSubmission, true);
  assert.match(body.preview.message, /not enabled/i);
  assert.equal(state.triggerCalls.length, 0);
}));

test("checkbox selection persists exact version and unselect clears only selection fields", () => withServer(async ({ request, state }) => {
  state.results.push(eligibleAddToEvent({ approvalStatus: "NOT_REVIEWED", resultStatus: "READY" }));
  const selected = await request("/api/admin/sales-agent/opportunities/selection", jsonOptions("admin", "POST", {
    records: [{ id: "64f000000000000000000001", expectedVersion: 1 }], selected: true,
  }));
  const selectedBody = await selected.json();
  assert.equal(selected.status, 200);
  assert.equal(selectedBody.selected, true);
  assert.equal(state.results[0].selectedVersion, 1);
  assert.equal(state.results[0].resultStatus, "READY");
  assert.equal(state.results[0].runId, "64d000000000000000000001");
  assert.equal(state.triggerCalls.length, 0);
  const cleared = await request("/api/admin/sales-agent/opportunities/selection", jsonOptions("admin", "POST", {
    records: [{ id: "64f000000000000000000001", expectedVersion: 1 }], selected: false,
  }));
  assert.equal(cleared.status, 200);
  assert.equal(state.results[0].selectedVersion, null);
  assert.equal(state.results[0].resultStatus, "READY");
  assert.equal(state.triggerCalls.length, 0);
}));

test("submission rejects request-body selection without persisted backend selection", () => withServer(async ({ request, state }) => {
  state.results.push(eligibleAddToEvent({ resultStatus: "READY" }));
  const response = await request("/api/admin/sales-agent/opportunities/submit-selected", jsonOptions("admin", "POST", {
    records: [{ id: "64f000000000000000000001", expectedVersion: 1 }],
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "PERSISTED_SELECTION_REQUIRED");
  assert.equal(state.triggerCalls.length, 0);
}));

test("selected Add to Event submission persists exact IDs and versions before triggering worker", () => withServer(async ({ request, state }) => {
  state.results.push(eligibleAddToEvent({ resultStatus: "READY", selectedVersion: 1 }));
  const empty = await request("/api/admin/sales-agent/opportunities/submit-selected", jsonOptions("admin", "POST", { records: [] }));
  assert.equal((await empty.json()).code, "OPPORTUNITY_SELECTION_REQUIRED");
  const response = await request("/api/admin/sales-agent/opportunities/submit-selected", jsonOptions("admin", "POST", {
    records: [{ id: "64f000000000000000000001", expectedVersion: 1 }],
  }));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.selectedCount, 1);
  assert.equal(body.estimatedCredits, 8);
  assert.equal(state.runs.at(-1).runType, "ADD_TO_EVENT_SUBMISSION");
  assert.deepEqual(state.runs.at(-1).submissionSelection.records[0], {
    id: "64f000000000000000000001", selectedVersion: 1, opportunityId: "ATE-1", platform: "addtoevent",
  });
  assert.equal(state.results[0].selectedVersion, 1);
  assert.equal(state.results[0].approvalStatus, "APPROVED");
  assert.equal(String(state.results[0].submissionLock.runId), String(state.runs.at(-1)._id));
  assert.equal(state.triggerCalls.at(-1).startCommand, "npm run worker:submit-addtoevent");
}));

test("selected Add to Event submission reconciles a failed stale job and triggers one replacement job", () => withServer(async ({ request, state }) => {
  state.results.push(eligibleAddToEvent({ resultStatus: "READY", selectedVersion: 1 }));
  const response = await request("/api/admin/sales-agent/opportunities/submit-selected", jsonOptions("admin", "POST", {
    records: [{ id: "64f000000000000000000001", expectedVersion: 1 }],
  }));
  assert.equal(response.status, 201);
  assert.equal(state.runs[0].status, "FAILED");
  assert.match(state.runs[0].activeLock, /^released:/);
  assert.equal(state.runs.at(-1).runType, "ADD_TO_EVENT_SUBMISSION");
  assert.equal(state.triggerCalls.length, 1);
  assert.equal(state.triggerCalls[0].startCommand, "npm run worker:submit-addtoevent");
}, {
  initialRuns: [{
    _id: "64c000000000000000000099",
    runType: "ADD_TO_EVENT_SUBMISSION",
    status: "QUEUED",
    activeLock: "global",
    renderJobId: "job-stale-failed",
    renderServiceId: "srv_test_sales_agent",
    createdAt: "2026-07-31T10:00:00.000Z",
    updatedAt: "2026-07-31T11:00:00.000Z",
  }],
  now: fixedApiNow,
  getRenderJobStatus: async () => ({
    status: "failed",
    checkedAt: fixedApiNow().toISOString(),
    finishedAt: fixedApiNow().toISOString(),
  }),
}));

test("submission backend rejects non-READY and stale selected records before worker trigger", () => withServer(async ({ request, state }) => {
  state.results.push(eligibleAddToEvent({ resultStatus: "MANUAL_REVIEW" }));
  const blocked = await request("/api/admin/sales-agent/opportunities/submit-selected", jsonOptions("admin", "POST", {
    records: [{ id: "64f000000000000000000001", expectedVersion: 1 }],
  }));
  assert.equal(blocked.status, 409);
  assert.equal(state.triggerCalls.length, 0);
  state.results[0].resultStatus = "READY";
  const stale = await request("/api/admin/sales-agent/opportunities/submit-selected", jsonOptions("admin", "POST", {
    records: [{ id: "64f000000000000000000001", expectedVersion: 2 }],
  }));
  assert.equal((await stale.json()).code, "OPPORTUNITY_VERSION_CONFLICT");
  assert.equal(state.triggerCalls.length, 0);
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
  assert.match(state.runs[0].activeLock, /^released:/);
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

test("worker-start grace defaults to two minutes and is configurable", () => {
  assert.equal(workerStartGraceMs({}), 120000);
  assert.equal(workerStartGraceMs({ SALES_AGENT_WORKER_START_GRACE_MS: "45000" }), 45000);
});

test("failure stages are supported by the run schema and server logs redact secrets", () => {
  const SalesAgentRun = require("../models/salesAgentRun");
  assert.equal(SalesAgentRun.collection.name, "salesagentruns");
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
