const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createSalesAgentRouter } = require("../routes/salesAgentRoutes");

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

function createHarness() {
  const state = { runs: [], results: [], settings: null, sequence: 1 };
  const SalesAgentRun = {
    async create(input) {
      if (state.runs.some((run) => ["QUEUED", "RUNNING"].includes(run.status))) {
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.runs.push(run);
      return structuredClone(run);
    },
    find() { return query(state.runs.slice().reverse()); },
    findById(id) { return query(state.runs.find((run) => run._id === id) || null); },
    findOne(filter) {
      const statuses = filter?.status?.$in || [];
      return query(state.runs.find((run) => statuses.includes(run.status)) || null);
    },
  };
  const SalesAgentOpportunityResult = {
    find(filter) {
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
  }));
  return { app, state };
}

async function withServer(run) {
  const { app, state } = createHarness();
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
}));

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
