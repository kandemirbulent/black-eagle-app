const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createController } = require("../public/js/sales-agent-dashboard.js");

test("dashboard contains the separate manual review submission controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/dashboard.html"), "utf8");
  assert.match(html, /id="runSalesAgentButton">Run Sales Agent</);
  assert.match(html, /id="submitManualReviewsButton"[^>]*>Submit Manual Reviews</);
  for (const id of [
    "manualReviewSelectedRun",
    "manualReviewSelectedCount",
    "manualReviewSubmissionStatus",
    "manualReviewProcessed",
    "manualReviewSubmitted",
    "manualReviewAlreadyQuoted",
    "manualReviewRemaining",
    "manualReviewFailedItems",
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.textContent = "";
    this.disabled = false;
    this.children = [];
    this.colSpan = 1;
    this.value = "";
    this.listeners = {};
    const classes = new Set(["hidden"]);
    this.classList = {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
      toggle: (value, force) => {
        if (force === true) classes.add(value);
        else if (force === false) classes.delete(value);
        else if (classes.has(value)) classes.delete(value);
        else classes.add(value);
      },
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
    "salesAgentFailedStage",
    "salesAgentFailureReason",
    "salesAgentErrorMessage",
    "runSalesAgentButton",
    "submitManualReviewsButton",
    "viewCurrentSalesAgentPartialResults",
    "cancelCurrentSalesAgentRun",
    "manualReviewSelectedRun",
    "manualReviewSelectedCount",
    "manualReviewSubmissionStatus",
    "manualReviewProcessed",
    "manualReviewSubmitted",
    "manualReviewAlreadyQuoted",
    "manualReviewRemaining",
    "manualReviewFailedItems",
    "retrySalesAgentButton",
    "salesAgentResultsTable",
    "salesAgentDetailsModal",
    "salesAgentDetailsModalTitle",
    "salesAgentDetailsContent",
    "closeSalesAgentDetailsModal",
    "salesAgentRunSelector",
    "salesAgentResultsNotice",
    "salesAgentPlatformFilter",
    "selectCurrentOpportunityPage",
    "clearOpportunitySelection",
    "selectedOpportunityCount",
    "previewSelectedOpportunities",
    "holdSelectedOpportunities",
    "rejectSelectedOpportunities",
    "editSelectedOpportunity",
    "submitSelectedOpportunities",
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

function controller({ responses = [], setIntervalFn, clearIntervalFn, onConfirm, modalConfirmation = false } = {}) {
  const documentRef = fakeDocument();
  const calls = [];
  const messages = [];
  const confirmations = [];
  const instance = createController({
    authFetch: queuedFetch(responses, calls),
    showMessage: (message, type) => messages.push({ message, type }),
    documentRef,
    setIntervalFn,
    clearIntervalFn,
    confirmFn: modalConfirmation ? null : (message) => {
      confirmations.push(message);
      return onConfirm ? onConfirm(message, documentRef) : true;
    },
  });
  return { instance, documentRef, calls, messages, confirmations };
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

test("RUNNING partial results are available on demand without replacing the default previous results", async () => {
  const context = controller({
    responses: [
      response(200, { success: true, status: "RUNNING", run: run({ status: "RUNNING", persistedResultCount: 2 }) }),
      response(200, { success: true, run: run({ status: "RUNNING", persistedResultCount: 2 }) }),
      response(200, { success: true, results: [
        { opportunityId: "PARTIAL-1", resultStatus: "QUOTE_READY" },
        { opportunityId: "PARTIAL-2", resultStatus: "MANUAL_REVIEW" },
      ] }),
      response(200, { success: true, run: run({ status: "RUNNING", persistedResultCount: 2 }) }),
      response(200, { success: true, results: [
        { opportunityId: "PARTIAL-1", resultStatus: "QUOTE_READY" },
        { opportunityId: "PARTIAL-2", resultStatus: "MANUAL_REVIEW" },
      ] }),
    ],
  });
  await context.instance.pollStatus();
  assert.equal(context.documentRef.elements.viewCurrentSalesAgentPartialResults.classList.contains("hidden"), false);
  await context.instance.viewCurrentPartialResults();
  assert.match(context.documentRef.elements.salesAgentResultsNotice.textContent, /Recovered persisted results: 2/);
});

test("CANCELED and FAILED runs remain selectable and display interruption recovery details", async () => {
  const canceled = run({ _id: "run-canceled", status: "CANCELED", lastCheckpointPage: 3, lastCheckpointAt: "2026-07-31T11:05:00.000Z" });
  const context = controller({ responses: [
    response(200, { success: true, run: canceled }),
    response(200, { success: true, results: [{ opportunityId: "SAVED-1", resultStatus: "QUOTE_READY" }] }),
    response(200, { success: true, run: run({ _id: "run-failed", status: "FAILED", lastCheckpointPage: 2 }) }),
    response(200, { success: true, results: [{ opportunityId: "SAVED-2", resultStatus: "DISCOVERED" }] }),
  ] });
  await context.instance.loadSelectedRun("run-canceled");
  assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, false);
  assert.match(context.documentRef.elements.salesAgentResultsNotice.textContent, /This run did not complete\. Showing results saved before interruption\./);
  assert.match(context.documentRef.elements.salesAgentResultsNotice.textContent, /Persisted results: 1/);
  assert.match(context.documentRef.elements.salesAgentResultsNotice.textContent, /Last checkpoint page: 3/);
  await context.instance.loadSelectedRun("run-failed");
  assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, false);
  assert.match(context.documentRef.elements.salesAgentResultsNotice.textContent, /Last checkpoint page: 2/);
});

test("CANCELED run with no persisted results reports that nothing was recovered", async () => {
  const context = controller({ responses: [
    response(200, { success: true, run: run({ _id: "run-canceled", status: "CANCELED" }) }),
    response(200, { success: true, results: [] }),
  ] });
  await context.instance.loadSelectedRun("run-canceled");
  assert.equal(context.documentRef.elements.salesAgentResultsNotice.textContent, "This run was canceled. No persisted results were recovered.");
});

test("Cancel Current Run confirms consequences, disables during request, and restores Run button", async () => {
  const confirmations = [];
  // Establish the exact current run ID through the normal status path without starting any worker.
  const context = controller({ responses: [
    response(200, { success: true, status: "RUNNING", run: run({ _id: "run-1", status: "RUNNING" }) }),
    response(200, { success: true, run: run({ _id: "run-1", status: "RUNNING" }) }),
    response(200, { success: true, results: [] }),
    response(200, { success: true, run: run({ _id: "run-1", status: "CANCELED", persistedResultCount: 0 }) }),
  ], onConfirm: (message) => { confirmations.push(message); return true; } });
  await context.instance.pollStatus();
  const cancelPromise = context.instance.cancelCurrentRun();
  assert.equal(context.documentRef.elements.cancelCurrentSalesAgentRun.disabled, true);
  assert.match(confirmations[0], /Run ID: run-1/);
  assert.match(confirmations[0], /Already submitted quotations will not be reversed/);
  assert.match(confirmations[0], /Already persisted results will be preserved/);
  assert.match(confirmations[0], /Unprocessed opportunities will remain unprocessed/);
  await cancelPromise;
  assert.equal(context.calls.at(-1).url, "/api/admin/sales-agent/runs/run-1/cancel");
  assert.equal(context.documentRef.elements.salesAgentCurrentStatus.textContent, "CANCELED");
  assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, false);
  assert.equal(context.documentRef.elements.runSalesAgentButton.textContent, "Run Sales Agent");
});

test("manual review button submits the explicitly selected run with confirmation", async () => {
  const context = controller({
    responses: [
      response(200, { success: true, run: run({ _id: "64d000000000000000000003", status: "COMPLETED" }) }),
      response(200, { success: true, results: [
        { opportunityId: "A", resultStatus: "MANUAL_REVIEW" },
        { opportunityId: "B", resultStatus: "MANUAL_REVIEW" },
      ] }),
      response(201, { success: true, run: {
        _id: "64e000000000000000000001",
        runType: "MANUAL_REVIEW_RESUME",
        sourceRunId: "64d000000000000000000003",
        status: "QUEUED",
        manualReviewResume: { selectedCount: 2, remainingManualReview: 2 },
      } }),
    ],
    setIntervalFn: () => 2,
  });
  context.instance.renderRunHistory([run({
    _id: "64d000000000000000000003",
    status: "COMPLETED",
    totals: { manualReview: 2 },
  })]);
  await context.instance.loadSelectedRun("64d000000000000000000003");
  await context.instance.submitManualReviews();
  assert.equal(context.calls[2].url, "/api/admin/sales-agent/manual-review-runs");
  assert.deepEqual(JSON.parse(context.calls[2].options.body), {
    sourceRunId: "64d000000000000000000003",
  });
  assert.match(context.confirmations[0], /Selected Run: 64d000000000000000000003/);
  assert.match(context.confirmations[0], /Manual Review count: 2/);
  assert.match(context.confirmations[0], /Discovery WILL NOT run/);
  assert.match(context.confirmations[0], /OpenAI WILL NOT run/);
  assert.match(context.confirmations[0], /Eligible quotations WILL be submitted/);
  assert.equal(context.documentRef.elements.submitManualReviewsButton.textContent, "Manual Reviews Queued...");
  assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, false);
});

test("manual review submission re-reads the dropdown and never uses a cached displayed run", async () => {
  const context = controller({
    responses: [
      response(200, { success: true, run: run({ _id: "64d000000000000000000010", status: "COMPLETED" }) }),
      response(200, { success: true, results: [{ opportunityId: "A", resultStatus: "MANUAL_REVIEW" }] }),
    ],
  });
  context.instance.renderRunHistory([
    run({ _id: "64d000000000000000000010", status: "COMPLETED", totals: { manualReview: 1 } }),
    run({ _id: "64d000000000000000000011", status: "COMPLETED", totals: { manualReview: 9 } }),
  ]);
  await context.instance.loadSelectedRun("64d000000000000000000010");
  context.documentRef.elements.salesAgentRunSelector.value = "64d000000000000000000011";
  await context.instance.submitManualReviews();
  assert.equal(context.calls.length, 2);
  assert.equal(context.confirmations.length, 0);
  assert.match(context.messages.at(-1).message, /Select a run/i);
});

test("manual review submission aborts if the dropdown changes during confirmation", async () => {
  const selectedRunId = "64d000000000000000000020";
  const context = controller({
    responses: [
      response(200, { success: true, run: run({ _id: selectedRunId, status: "COMPLETED" }) }),
      response(200, { success: true, results: [
        { resultStatus: "MANUAL_REVIEW" }, { resultStatus: "MANUAL_REVIEW" },
      ] }),
    ],
    onConfirm: (_message, documentRef) => {
      documentRef.elements.salesAgentRunSelector.value = "64d000000000000000000021";
      return true;
    },
  });
  context.instance.renderRunHistory([
    run({ _id: selectedRunId, status: "COMPLETED", totals: { manualReview: 2 } }),
    run({ _id: "64d000000000000000000021", status: "COMPLETED", totals: { manualReview: 3 } }),
  ]);
  await context.instance.loadSelectedRun(selectedRunId);
  await context.instance.submitManualReviews();
  assert.equal(context.calls.length, 2);
  assert.match(context.messages.at(-1).message, /selected run changed/i);
});

test("manual review status is separate and terminal state re-enables only its button", () => {
  const context = controller();
  context.instance.renderResults([{ resultStatus: "MANUAL_REVIEW" }]);
  context.instance.renderManualReviewRun({
    status: "COMPLETED",
    manualReviewResume: {
      processed: 3,
      submitted: 2,
      alreadyQuoted: 1,
      remainingManualReview: 0,
      failedItems: 0,
    },
  });
  assert.equal(context.documentRef.elements.manualReviewSubmissionStatus.textContent, "COMPLETED");
  assert.equal(context.documentRef.elements.manualReviewProcessed.textContent, "3");
  assert.equal(context.documentRef.elements.manualReviewSubmitted.textContent, "2");
  assert.equal(context.documentRef.elements.manualReviewAlreadyQuoted.textContent, "1");
  assert.equal(context.documentRef.elements.submitManualReviewsButton.textContent, "Submit Manual Reviews");
});

test("run button is disabled only for fresh active statuses", () => {
  const context = controller();
  for (const status of ["QUEUED", "RUNNING"]) {
    context.instance.renderRun(run({ status }));
    assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, true);
  }
  for (const status of ["COMPLETED", "FAILED"]) {
    context.instance.renderRun(run({ status }));
    assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, false);
    assert.equal(context.documentRef.elements.runSalesAgentButton.textContent, "Run Sales Agent");
  }
});

test("failed run renders safe stage, reason and error diagnostics", () => {
  const context = controller();
  context.instance.renderRun(run({
    status: "FAILED",
    failedStage: "OPENAI",
    failureReason: "OpenAI analysis could not be completed.",
    errorMessage: "The upstream request timed out.",
  }));
  assert.equal(context.documentRef.elements.salesAgentFailedStage.textContent, "OPENAI");
  assert.equal(context.documentRef.elements.salesAgentFailureReason.textContent, "OpenAI analysis could not be completed.");
  assert.equal(context.documentRef.elements.salesAgentErrorMessage.textContent, "The upstream request timed out.");

  context.instance.renderRun(run({
    status: "FAILED",
    failedStage: "RENDER_TRIGGER",
    failureReason: "Authorization: Bearer secret-token",
    errorMessage: "api_key=secret-value",
  }));
  assert.equal(context.documentRef.elements.salesAgentFailureReason.textContent, "Sensitive or technical error details were withheld.");
  assert.equal(context.documentRef.elements.salesAgentErrorMessage.textContent, "Sensitive or technical error details were withheld.");
});

test("worker trigger failure re-enables the run button with a safe message", async () => {
  const context = controller({
    responses: [response(503, {
      success: false,
      code: "WORKER_TRIGGER_FAILED",
      message: "Sales Agent worker could not be started.",
      run: run({ status: "FAILED", failureCode: "WORKER_TRIGGER_FAILED" })
    })],
  });
  await context.instance.startRun();
  assert.equal(context.documentRef.elements.salesAgentCurrentStatus.textContent, "FAILED");
  assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, false);
  assert.equal(context.documentRef.elements.runSalesAgentButton.textContent, "Run Sales Agent");
  assert.match(context.messages[0].message, /worker could not be started/i);
  assert.doesNotMatch(JSON.stringify(context.messages), /token|secret|authorization/i);
});

test("Render trigger failure displays the exact safe HTTP diagnostic", async () => {
  const safeMessage = "Render API returned 403 Forbidden: API key lacks permission";
  const context = controller({
    responses: [response(503, {
      success: false,
      code: "WORKER_TRIGGER_FAILED",
      message: safeMessage,
      run: run({
        status: "FAILED",
        failedStage: "RENDER_TRIGGER",
        failureReason: "Render could not create the Sales Agent job.",
        errorMessage: safeMessage,
      }),
    })],
  });
  await context.instance.startRun();
  assert.equal(context.documentRef.elements.salesAgentFailedStage.textContent, "RENDER_TRIGGER");
  assert.equal(context.documentRef.elements.salesAgentErrorMessage.textContent, safeMessage);
  assert.equal(context.messages[0].message, safeMessage);
  assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, false);
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
  assert.match(context.calls[3].url, /canonicalLatest=true$/);
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
  assert.equal(cells[1].textContent, "Wedding");
  assert.equal(cells[2].textContent, "ABC123");
  assert.equal(cells[5].textContent, "Quote submitted");
  assert.equal(cells[6].textContent, "2 Waiter, 1 Bartender");
  assert.match(cells[7].textContent, /£300\.00/);
  assert.equal(cells[8].textContent, "—");
  assert.equal(cells[9].textContent, "quote-1");
  assert.equal(cells[11].children[0].textContent, "View Details");
});

test("empty results show the empty state", () => {
  const context = controller();
  context.instance.renderResults([]);
  const row = context.documentRef.elements.salesAgentResultsTable.children[0];
  assert.equal(row.children[0].textContent, "No opportunity results yet.");
  assert.equal(row.children[0].colSpan, 12);
});

test("Add to Event rows keep customer quote and platform credits distinct", () => {
  const context = controller();
  context.instance.renderResults([
    {
      eventName: "Known credits", platform: "addtoevent", resultStatus: "READY", finalPrice: 420,
      platformCostEstimate: { unit: "CREDITS", status: "KNOWN", amount: 8 },
    },
    {
      eventName: "Unknown credits", platform: "addtoevent", resultStatus: "MANUAL_REVIEW", finalPrice: 350,
      platformCostEstimate: { unit: "CREDITS", status: "UNKNOWN" },
    },
  ]);
  const rows = context.documentRef.elements.salesAgentResultsTable.children;
  assert.equal(rows[0].children[3].textContent, "Add to Event");
  assert.match(rows[0].children[7].textContent, /£420\.00/);
  assert.equal(rows[0].children[8].textContent, "8 credits");
  assert.match(rows[1].children[7].textContent, /£350\.00/);
  assert.equal(rows[1].children[8].textContent, "UNKNOWN");
  rows[1].children[11].children[0].click();
  const detailText = flattenText(context.documentRef.elements.salesAgentDetailsContent);
  assert.match(detailText, /Customer quote\s+£350\.00/);
  assert.match(detailText, /Credits required\s+UNKNOWN/);
});

test("selection checkboxes persist, survive rerender/list reload, remain visible, and unselect cleanly", async () => {
  const context = controller({ responses: [
    response(200, { success: true, selected: true, opportunity: { selectedVersion: 1 } }),
    response(200, { success: true, selected: false, opportunity: { selectedVersion: null } }),
  ] });
  context.documentRef.elements.salesAgentPlatformFilter.value = "addtoevent";
  context.instance.renderResults([
    { _id: "a", opportunityId: "ATE-1", platform: "addtoevent", recordVersion: 1, manualSelectionEligible: true },
    { _id: "b", opportunityId: "TOG-1", platform: "togather", recordVersion: 1, manualSelectionEligible: false, manualSelectionBlocker: "TOGATHER_AUTOMATIC_POLICY" },
    { _id: "c", opportunityId: "ATE-2", platform: "addtoevent", recordVersion: 1, manualSelectionEligible: false, approvalStatus: "REJECTED" },
    { _id: "d", opportunityId: "POP-1", platform: "poptop", recordVersion: 1, manualSelectionEligible: true },
  ]);
  const rows = context.documentRef.elements.salesAgentResultsTable.children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].children[0].checked, false);
  assert.equal(rows[0].children[0].children[0].disabled, false);
  assert.equal(rows[1].children[0].children[0].disabled, true);
  await context.instance.selectAllCurrentPage();
  assert.deepEqual(context.instance.selectedReferences(), [{ id: "a", expectedVersion: 1 }]);
  assert.equal(context.calls[0].url, "/api/admin/sales-agent/opportunities/selection");
  assert.equal(JSON.parse(context.calls[0].options.body).selected, true);
  context.instance.renderResults([
    { _id: "a", opportunityId: "ATE-1", platform: "addtoevent", recordVersion: 1, selectedVersion: 1, manualSelectionEligible: true },
    { _id: "c", opportunityId: "ATE-2", platform: "addtoevent", recordVersion: 1, manualSelectionEligible: false },
  ]);
  assert.deepEqual(context.instance.selectedReferences(), [{ id: "a", expectedVersion: 1 }]);
  assert.equal(context.documentRef.elements.salesAgentResultsTable.children.length, 2);
  assert.equal(context.documentRef.elements.salesAgentResultsTable.children[0].children[0].children[0].checked, true);
  const selectedCheckbox = context.documentRef.elements.salesAgentResultsTable.children[0].children[0].children[0];
  selectedCheckbox.checked = false;
  await selectedCheckbox.listeners.change();
  assert.deepEqual(context.instance.selectedReferences(), []);
  assert.equal(JSON.parse(context.calls[1].options.body).selected, false);
  assert.equal(context.documentRef.elements.selectedOpportunityCount.textContent, "0 selected");
  assert.equal(context.calls.some((call) => /submit-selected/.test(call.url)), false);
});

test("Submit Selected Quotes previews count/credits then posts only exact selected versions", async () => {
  const context = controller({ responses: [response(200, { success: true, preview: {
    selectedCount: 1, opportunityIds: ["ATE-1"], platformBreakdown: { addtoevent: 1 },
    combinedQuotationValue: 500, estimatedRevenue: 500, estimatedProfit: 150, estimatedCredits: 6, blocked: [],
  } }), response(201, { success: true, selectedCount: 1, estimatedCredits: 6, run: { _id: "submission-1" } }),
  response(200, { success: true, runs: [] }), response(200, { success: true, status: "IDLE", run: null }),
  response(200, { success: true, runs: [] })] });
  context.instance.renderResults([
    { _id: "a", opportunityId: "ATE-1", platform: "addtoevent", recordVersion: 2, selectedVersion: 2, manualSelectionEligible: true },
  ]);
  await context.instance.submitSelectedOpportunities();
  assert.equal(context.calls.length, 5);
  assert.equal(context.calls[0].url, "/api/admin/sales-agent/opportunities/selection-preview");
  assert.deepEqual(JSON.parse(context.calls[0].options.body), { records: [{ id: "a", expectedVersion: 2 }] });
  assert.equal(context.calls[1].url, "/api/admin/sales-agent/opportunities/submit-selected");
  assert.deepEqual(JSON.parse(context.calls[1].options.body), { records: [{ id: "a", expectedVersion: 2 }] });
  assert.match(context.confirmations[0], /1 selected.*6 credits/i);
  assert.deepEqual(context.instance.selectedReferences(), []);
});

test("Submit Selected Quotes uses one in-page confirmation and queues only once", async () => {
  const context = controller({ modalConfirmation: true, responses: [response(200, { success: true, preview: {
    selectedCount: 1, opportunityIds: ["ATE-1"], platformBreakdown: { addtoevent: 1 },
    combinedQuotationValue: 500, estimatedCredits: 6, blocked: [],
  } }), response(201, { success: true, selectedCount: 1, estimatedCredits: 6, run: { _id: "submission-1" } }),
  response(200, { success: true, runs: [] }), response(200, { success: true, status: "IDLE", run: null }),
  response(200, { success: true, runs: [] })] });
  context.instance.renderResults([
    { _id: "a", opportunityId: "ATE-1", platform: "addtoevent", recordVersion: 2, selectedVersion: 2, manualSelectionEligible: true },
  ]);
  const pending = context.instance.submitSelectedOpportunities();
  await new Promise((resolve) => setImmediate(resolve));
  const confirmButton = context.documentRef.elements.salesAgentDetailsContent.children
    .flatMap((child) => child.children || [])
    .find((child) => child.textContent === "Confirm Submission");
  assert.ok(confirmButton);
  confirmButton.click();
  confirmButton.click();
  await pending;
  assert.equal(context.calls.filter((call) => /submit-selected/.test(call.url)).length, 1);
  assert.equal(context.confirmations.length, 0);
});

test("submission confirmation refusal performs no submit request and preserves selection", async () => {
  const context = controller({ onConfirm: () => false, responses: [response(200, { success: true, preview: {
    selectedCount: 1, opportunityIds: ["ATE-1"], platformBreakdown: { addtoevent: 1 }, combinedQuotationValue: 500,
    estimatedCredits: 6, blocked: [],
  } })] });
  context.instance.renderResults([{ _id: "a", opportunityId: "ATE-1", platform: "addtoevent", recordVersion: 2, selectedVersion: 2, manualSelectionEligible: true }]);
  await context.instance.submitSelectedOpportunities();
  assert.equal(context.calls.length, 1);
  assert.deepEqual(context.instance.selectedReferences(), [{ id: "a", expectedVersion: 2 }]);
});

test("stale worker failure stops polling and re-enables the run button safely", async () => {
  let tick;
  const context = controller({
    responses: [
      response(201, { success: true, run: run({ status: "QUEUED" }) }),
      response(200, { success: true, status: "IDLE", run: null }),
      response(200, {
        success: true,
        run: run({
          status: "FAILED",
          failureCode: "WORKER_NOT_AVAILABLE",
          errorSummary: "backend-only detail",
        }),
      }),
      response(200, { success: true, results: [] }),
    ],
    setIntervalFn: (callback) => {
      tick = callback;
      return 9;
    },
  });
  await context.instance.startRun();
  await tick();
  assert.equal(context.documentRef.elements.salesAgentCurrentStatus.textContent, "FAILED");
  assert.equal(context.documentRef.elements.runSalesAgentButton.disabled, false);
  assert.equal(context.documentRef.elements.runSalesAgentButton.textContent, "Run Sales Agent");
  assert.equal(
    context.messages.at(-1).message,
    "Previous run expired because no worker was available. You can start a new run."
  );
  assert.doesNotMatch(JSON.stringify(context.messages), /backend-only|credential|authorization/i);
});

test("a new queued run preserves previous results and shows a notice", async () => {
  const context = controller({
    responses: [response(201, { success: true, run: run({ _id: "run-new" }) })],
    setIntervalFn: () => 1
  });
  context.instance.renderResults([
    { eventName: "Previous Wedding", resultStatus: "MANUAL_REVIEW" }
  ]);
  await context.instance.startRun();
  const row = context.documentRef.elements.salesAgentResultsTable.children[0];
  assert.equal(row.children[1].textContent, "Previous Wedding");
  assert.match(
    context.documentRef.elements.salesAgentResultsNotice.textContent,
    /Current run is QUEUED.*previous completed run/
  );
});

test("queued cards remain current while canonical pending previous result is displayed", async () => {
  const context = controller({
    responses: [response(201, { success: true, run: run({ _id: "run-new", status: "QUEUED" }) })],
    setIntervalFn: () => 1
  });
  context.instance.renderResults([{
    eventName: "Lexie's Wedding",
    opportunityId: "RUYN9WR7",
    resultStatus: "PENDING",
    quoteUuid: "1677448a-d2ba-4512-8f13-dacdfaafdbec",
    blockingReasons: []
  }]);
  await context.instance.startRun();
  const row = context.documentRef.elements.salesAgentResultsTable.children[0];
  assert.equal(context.documentRef.elements.salesAgentCurrentStatus.textContent, "QUEUED");
  assert.equal(row.children[4].textContent, "PENDING");
  assert.equal(row.children[5].textContent, "Quote submitted");
  assert.equal(row.children[9].textContent, "1677448a-d2ba-4512-8f13-dacdfaafdbec");
});

test("current run partial results require the explicit view action", async () => {
  const context = controller({
    responses: [
      response(201, { success: true, run: run({ _id: "run-new", status: "RUNNING" }) }),
      response(200, {
        success: true,
        status: "RUNNING",
        run: run({ _id: "run-new", status: "RUNNING", persistedResultCount: 1 })
      }),
      response(200, { success: true, run: run({ _id: "run-new", status: "RUNNING", persistedResultCount: 1 }) }),
      response(200, {
        success: true,
        results: [{ eventName: "Current Event", resultStatus: "SENT" }]
      }),
      response(200, { success: true, run: run({ _id: "run-new", status: "RUNNING", persistedResultCount: 1 }) }),
      response(200, { success: true, results: [{ eventName: "Current Event", resultStatus: "SENT" }] })
    ],
    setIntervalFn: () => 1
  });
  context.instance.renderResults([
    { eventName: "Previous Event", resultStatus: "MANUAL_REVIEW" }
  ]);
  await context.instance.startRun();
  await context.instance.pollStatus();
  let row = context.documentRef.elements.salesAgentResultsTable.children[0];
  assert.equal(row.children[1].textContent, "Previous Event");
  await context.instance.viewCurrentPartialResults();
  row = context.documentRef.elements.salesAgentResultsTable.children[0];
  assert.equal(row.children[1].textContent, "Current Event");
  assert.match(context.documentRef.elements.salesAgentResultsNotice.textContent, /Recovered persisted results: 1/);
});

test("run history lists at most 20 safe summary options", () => {
  const context = controller();
  const runs = Array.from({ length: 22 }, (_, index) =>
    run({
      _id: `run-${index}`,
      status: "COMPLETED",
      totals: { opportunitiesFound: 2, quotesSubmitted: 1, manualReview: 1 }
    })
  );
  context.instance.renderRunHistory(runs);
  const options = context.documentRef.elements.salesAgentRunSelector.children;
  assert.equal(options.length, 21);
  assert.equal(options[0].textContent, "Latest Run");
  assert.match(options[1].textContent, /COMPLETED.*2 found.*1 submitted.*1 review/);
});

test("selecting an older run loads its cards and results", async () => {
  const context = controller({
    responses: [
      response(200, {
        success: true,
        run: run({
          _id: "old-run",
          status: "COMPLETED",
          totals: { opportunitiesFound: 1, manualReview: 1 }
        })
      }),
      response(200, {
        success: true,
        results: [{ eventName: "Old Event", resultStatus: "MANUAL_REVIEW" }]
      })
    ]
  });
  await context.instance.loadSelectedRun("old-run");
  assert.equal(context.calls[0].url, "/api/admin/sales-agent/runs/old-run");
  assert.equal(context.calls[1].url, "/api/admin/sales-agent/runs/old-run/results");
  assert.equal(context.documentRef.elements.salesAgentCurrentStatus.textContent, "COMPLETED");
  assert.equal(
    context.documentRef.elements.salesAgentResultsTable.children[0].children[1].textContent,
    "Old Event"
  );
});

test("Latest Run selection returns to automatic current-run behavior without delete calls", async () => {
  const context = controller({
    responses: [
      response(200, {
        success: true,
        runs: [run({ _id: "latest-run", status: "COMPLETED" })]
      }),
      response(200, { success: true, status: "IDLE", run: null }),
      response(200, {
        success: true,
        run: run({ _id: "latest-run", status: "COMPLETED" })
      }),
      response(200, {
        success: true,
        results: [{ eventName: "Latest Event", resultStatus: "SENT" }]
      }),
      response(200, {
        success: true,
        runs: [run({ _id: "latest-run", status: "COMPLETED" })]
      }),
      response(200, { success: true, status: "IDLE", run: null }),
      response(200, {
        success: true,
        run: run({ _id: "latest-run", status: "COMPLETED" })
      }),
      response(200, {
        success: true,
        results: [{ eventName: "Latest Event", resultStatus: "SENT" }]
      })
    ]
  });
  await context.instance.init();
  context.documentRef.elements.salesAgentRunSelector.value = "";
  await context.documentRef.elements.salesAgentRunSelector.listeners.change();
  assert.equal(
    context.documentRef.elements.salesAgentResultsTable.children[0].children[1].textContent,
    "Latest Event"
  );
  assert.equal(
    context.calls.some((call) => String(call.options.method || "GET").toUpperCase() === "DELETE"),
    false
  );
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
  assert.equal(row.children[5].textContent, "Travel cannot be priced safely. (+1 more)");
  row.children[11].children[0].click();
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
    { resultStatus: "PENDING", quoteUuid: "verified-quote" },
    { resultStatus: "FAILED", error: "Error: request failed\n at worker (secret.js:1:2)" },
    { resultStatus: "SKIPPED", blockingReasons: ["Opportunity was already quoted."] }
  ]);
  const rows = context.documentRef.elements.salesAgentResultsTable.children;
  assert.ok(rows[0].children[5].textContent.length <= 120);
  assert.match(rows[0].children[5].textContent, /\(\+1 more\)$/);
  assert.equal(rows[1].children[5].textContent, "Manual review required; no reason was recorded.");
  assert.equal(rows[2].children[5].textContent, "Quote submitted");
  assert.equal(rows[3].children[5].textContent, "Quote submitted");
  assert.equal(rows[3].children[9].textContent, "verified-quote");
  assert.equal(rows[4].children[5].textContent, "Sensitive or technical error details were withheld.");
  assert.equal(rows[5].children[5].textContent, "Opportunity was already quoted.");
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
