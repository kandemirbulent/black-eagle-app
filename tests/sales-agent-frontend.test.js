const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../public/js/sales-agent-dashboard.js");

class FakeElement {
  constructor() {
    this.textContent = "";
    this.disabled = false;
    this.children = [];
    this.colSpan = 1;
    const classes = new Set(["hidden"]);
    this.classList = {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    };
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

function fakeDocument() {
  const ids = [
    "salesAgentCurrentStatus",
    "salesAgentLastRun",
    "salesAgentOpportunitiesFound",
    "salesAgentQuotesSubmitted",
    "salesAgentManualReview",
    "salesAgentSkipped",
    "salesAgentFailed",
    "salesAgentOpenAiCalls",
    "salesAgentPlatformActions",
    "runSalesAgentButton",
    "retrySalesAgentButton",
    "salesAgentResultsTable",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const listeners = {};
  return {
    hidden: false,
    elements,
    listeners,
    getElementById: (id) => elements[id],
    createElement: () => new FakeElement(),
    addEventListener: (name, listener) => {
      listeners[name] = listener;
    },
  };
}

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  };
}

function queuedFetch(entries, calls) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    const next = entries.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error(`Unexpected request: ${url}`);
    return next;
  };
}

function controller({ responses = [], setIntervalFn, clearIntervalFn } = {}) {
  const documentRef = fakeDocument();
  const calls = [];
  const messages = [];
  const instance = createController({
    authFetch: queuedFetch(responses, calls),
    showMessage: (message, type) => messages.push({ message, type }),
    documentRef,
    setIntervalFn,
    clearIntervalFn,
  });
  return { instance, documentRef, calls, messages };
}

const run = (overrides = {}) => ({
  _id: "run-1",
  status: "QUEUED",
  createdAt: "2026-07-25T12:00:00.000Z",
  totals: {},
  ...overrides,
});

test("Run button sends POST and renders queued run", async () => {
  const context = controller({
    responses: [response(201, { success: true, run: run() })],
    setIntervalFn: () => 1,
  });
  await context.instance.startRun();
  assert.equal(context.calls[0].url, "/api/admin/sales-agent/runs");
  assert.equal(context.calls[0].options.method, "POST");
  assert.equal(context.documentRef.elements.salesAgentCurrentStatus.textContent, "QUEUED");
  assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, true);
  assert.equal(context.documentRef.elements.runSalesAgentButton.textContent, "Queued...");
});

test("409 active-run response loads existing active run without a second POST", async () => {
  const context = controller({
    responses: [
      response(409, {
        success: false,
        code: "SALES_AGENT_RUN_ALREADY_ACTIVE",
      }),
      response(200, { success: true, status: "RUNNING", run: run({ status: "RUNNING" }) }),
      response(200, { success: true, run: run({ status: "RUNNING" }) }),
      response(200, { success: true, results: [] }),
    ],
    setIntervalFn: () => 1,
  });
  await context.instance.startRun();
  assert.equal(context.calls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(context.documentRef.elements.salesAgentCurrentStatus.textContent, "RUNNING");
  assert.match(context.messages[0].message, /already active/i);
});

test("polling stops when run becomes COMPLETED or FAILED", async () => {
  for (const terminalStatus of ["COMPLETED", "FAILED"]) {
    let tick;
    let cleared = 0;
    const context = controller({
      responses: [
        response(201, { success: true, run: run({ status: "RUNNING" }) }),
        response(200, { success: true, status: "IDLE", run: null }),
        response(200, { success: true, run: run({ status: terminalStatus }) }),
        response(200, { success: true, results: [] }),
      ],
      setIntervalFn: (callback) => {
        tick = callback;
        return 7;
      },
      clearIntervalFn: () => {
        cleared += 1;
      },
    });
    await context.instance.startRun();
    await tick();
    assert.equal(
      context.documentRef.elements.salesAgentCurrentStatus.textContent,
      terminalStatus
    );
    assert.equal(context.instance.isPolling(), false);
    assert.equal(cleared, 1);
  }
});

test("totals map to the correct status cards", () => {
  const context = controller();
  context.instance.renderRun(
    run({
      status: "COMPLETED",
      completedAt: "2026-07-25T13:00:00.000Z",
      totals: {
        opportunitiesFound: 9,
        quotesSubmitted: 2,
        manualReview: 3,
        skipped: 2,
        failed: 2,
        openAiCalls: 4,
        platformActions: 2,
      },
    })
  );
  assert.equal(context.documentRef.elements.salesAgentOpportunitiesFound.textContent, "9");
  assert.equal(context.documentRef.elements.salesAgentQuotesSubmitted.textContent, "2");
  assert.equal(context.documentRef.elements.salesAgentManualReview.textContent, "3");
  assert.equal(context.documentRef.elements.salesAgentSkipped.textContent, "2");
  assert.equal(context.documentRef.elements.salesAgentFailed.textContent, "2");
  assert.equal(context.documentRef.elements.salesAgentOpenAiCalls.textContent, "4");
  assert.equal(context.documentRef.elements.salesAgentPlatformActions.textContent, "2");
});

test("results render staff, GBP price and identifiers", () => {
  const context = controller();
  context.instance.renderResults([
    {
      eventName: "Wedding",
      opportunityId: "ABC123",
      platform: "togather",
      resultStatus: "SENT",
      staffBreakdown: [
        { role: "Waiter", quantity: 2 },
        { role: "Bartender", quantity: 1 },
      ],
      finalPrice: 300,
      quoteUuid: "quote-1",
      updatedAt: "2026-07-25T13:00:00.000Z",
    },
  ]);
  const cells = context.documentRef.elements.salesAgentResultsTable.children[0].children;
  assert.equal(cells[0].textContent, "Wedding");
  assert.equal(cells[1].textContent, "ABC123");
  assert.equal(cells[4].textContent, "2 Waiter, 1 Bartender");
  assert.match(cells[5].textContent, /£300\.00/);
  assert.equal(cells[6].textContent, "quote-1");
});

test("empty results show the empty state", () => {
  const context = controller();
  context.instance.renderResults([]);
  const row = context.documentRef.elements.salesAgentResultsTable.children[0];
  assert.equal(row.children[0].textContent, "No opportunity results yet.");
  assert.equal(row.children[0].colSpan, 8);
});

test("network and malformed responses do not crash the page", async () => {
  const network = controller({ responses: [new Error("network details")] });
  await assert.doesNotReject(() => network.instance.refresh());
  assert.equal(network.documentRef.elements.retrySalesAgentButton.classList.contains("hidden"), false);
  assert.match(network.messages[0].message, /could not be loaded/i);

  const malformed = controller({ responses: [response(200, null)] });
  await assert.doesNotReject(() => malformed.instance.refresh());
  assert.equal(malformed.documentRef.elements.retrySalesAgentButton.classList.contains("hidden"), false);
});
