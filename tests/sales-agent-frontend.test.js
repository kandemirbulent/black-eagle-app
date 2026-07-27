const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../public/js/sales-agent-dashboard.js");

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.textContent = "";
    this.disabled = false;
    this.children = [];
    this.colSpan = 1;
    this.listeners = {};
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

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  click() {
    this.listeners.click?.({ target: this });
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
    "salesAgentDetailsModal",
    "salesAgentDetailsModalTitle",
    "salesAgentDetailsContent",
    "closeSalesAgentDetailsModal",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const listeners = {};
  return {
    hidden: false,
    elements,
    listeners,
    getElementById: (id) => elements[id],
    createElement: (tagName) => new FakeElement(tagName),
    addEventListener: (name, listener) => {
      listeners[name] = listener;
    },
  };
}

function flattenText(element) {
  return [element.textContent, ...element.children.flatMap(flattenText)].filter(Boolean).join(" ");
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
  assert.equal(cells[4].textContent, "Quote submitted");
  assert.equal(cells[5].textContent, "2 Waiter, 1 Bartender");
  assert.match(cells[6].textContent, /£300\.00/);
  assert.equal(cells[7].textContent, "quote-1");
  assert.equal(cells[9].children[0].textContent, "View Details");
});

test("empty results show the empty state", () => {
  const context = controller();
  context.instance.renderResults([]);
  const row = context.documentRef.elements.salesAgentResultsTable.children[0];
  assert.equal(row.children[0].textContent, "No opportunity results yet.");
  assert.equal(row.children[0].colSpan, 10);
});

test("manual review summary and details show reasons, assumptions, staffing and prices", () => {
  const context = controller();
  const result = {
    eventName: "Wedding",
    opportunityId: "RSAEWYMM",
    platform: "togather",
    analysisStatus: "MANUAL_REVIEW",
    resultStatus: "MANUAL_REVIEW",
    blockingReasons: ["Travel cannot be priced safely.", "Start time needs confirmation."],
    assumptions: ["One vehicle is assumed."],
    staffBreakdown: [{ role: "Waiter", quantity: 3 }],
    workingHours: 8,
    travelHours: 2,
    labourSubtotal: 480,
    travelLabour: 120,
    vehicleCost: 50,
    parkingCost: 10,
    accommodationCost: 0,
    finalPrice: 660,
    quoteSubmitted: false,
    aiCallUsed: false
  };
  context.instance.renderResults([result]);
  const row = context.documentRef.elements.salesAgentResultsTable.children[0];
  assert.equal(row.children[4].textContent, "Travel cannot be priced safely. (+1 more)");
  row.children[9].children[0].click();
  const detailText = flattenText(context.documentRef.elements.salesAgentDetailsContent);
  assert.match(detailText, /manual review is required/i);
  assert.match(detailText, /Travel cannot be priced safely/);
  assert.match(detailText, /One vehicle is assumed/);
  assert.match(detailText, /Waiter: 3/);
  assert.match(detailText, /£660\.00/);
});

test("review summaries handle long, missing, sent, failed and skipped results safely", () => {
  const context = controller();
  const longReason = "Travel or accommodation cost could not be priced safely because the available route information is incomplete and requires operational review before submission.";
  context.instance.renderResults([
    { resultStatus: "MANUAL_REVIEW", blockingReasons: [longReason, "Second reason"] },
    { resultStatus: "MANUAL_REVIEW" },
    { resultStatus: "SENT" },
    { resultStatus: "FAILED", error: "Error: request failed\n at worker (secret.js:1:2)" },
    { resultStatus: "SKIPPED", blockingReasons: ["Opportunity was already quoted."] }
  ]);
  const rows = context.documentRef.elements.salesAgentResultsTable.children;
  assert.ok(rows[0].children[4].textContent.length <= 120);
  assert.match(rows[0].children[4].textContent, /\(\+1 more\)$/);
  assert.equal(rows[1].children[4].textContent, "Manual review required; no reason was recorded.");
  assert.equal(rows[2].children[4].textContent, "Quote submitted");
  assert.equal(rows[3].children[4].textContent, "Sensitive or technical error details were withheld.");
  assert.equal(rows[4].children[4].textContent, "Opportunity was already quoted.");
});

test("details use safe text, fallbacks, Close and Escape", async () => {
  const context = controller({ responses: [new Error("offline")] });
  await context.instance.init();
  const unsafe = '<img src=x onerror="globalThis.compromised=true">';
  context.instance.openDetails({
    eventName: unsafe,
    resultStatus: "FAILED",
    staffBreakdown: []
  });
  const content = context.documentRef.elements.salesAgentDetailsContent;
  assert.match(flattenText(content), /No blocking reason was recorded/);
  assert.match(flattenText(content), /No assumptions were recorded/);
  assert.equal(context.documentRef.elements.salesAgentDetailsModalTitle.textContent, unsafe);
  assert.equal(context.documentRef.elements.salesAgentDetailsModal.children.length, 0);

  context.documentRef.elements.closeSalesAgentDetailsModal.click();
  assert.equal(
    context.documentRef.elements.salesAgentDetailsModal.classList.contains("hidden"),
    true
  );

  context.instance.openDetails({ resultStatus: "MANUAL_REVIEW" });
  context.documentRef.listeners.keydown({ key: "Escape" });
  assert.equal(
    context.documentRef.elements.salesAgentDetailsModal.classList.contains("hidden"),
    true
  );
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
