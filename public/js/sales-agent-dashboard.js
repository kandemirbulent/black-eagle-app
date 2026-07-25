(function attachSalesAgentDashboard(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SalesAgentDashboard = api;
})(typeof window !== "undefined" ? window : globalThis, function salesAgentDashboardFactory() {
  const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);
  const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED"]);

  function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function formatDateTime(value) {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
  }

  function formatPrice(value) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP"
    }).format(safeNumber(value));
  }

  function staffText(staffBreakdown) {
    if (!Array.isArray(staffBreakdown) || !staffBreakdown.length) return "—";
    const parts = staffBreakdown
      .map((item) => {
        const role = String(item?.role || "").trim();
        const quantity = safeNumber(item?.quantity);
        return role && quantity > 0 ? `${quantity} ${role}` : "";
      })
      .filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  }

  function text(value, fallback = "—") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  async function readPayload(response) {
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  }

  function createController({
    authFetch,
    showMessage,
    documentRef,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  }) {
    const byId = (id) => documentRef.getElementById(id);
    const elements = {
      status: byId("salesAgentCurrentStatus"),
      lastRun: byId("salesAgentLastRun"),
      opportunitiesFound: byId("salesAgentOpportunitiesFound"),
      quotesSubmitted: byId("salesAgentQuotesSubmitted"),
      manualReview: byId("salesAgentManualReview"),
      skipped: byId("salesAgentSkipped"),
      failed: byId("salesAgentFailed"),
      openAiCalls: byId("salesAgentOpenAiCalls"),
      platformActions: byId("salesAgentPlatformActions"),
      runButton: byId("runSalesAgentButton"),
      retryButton: byId("retrySalesAgentButton"),
      resultsTable: byId("salesAgentResultsTable")
    };
    let currentRunId = "";
    let pollingTimer = null;

    function showRetryError(message) {
      showMessage(message, "error");
      elements.retryButton?.classList.remove("hidden");
    }

    function clearRetry() {
      elements.retryButton?.classList.add("hidden");
    }

    function updateButton(status) {
      const normalized = String(status || "IDLE").toUpperCase();
      const active = ACTIVE_STATUSES.has(normalized);
      elements.runButton.disabled = active;
      elements.runButton.textContent =
        normalized === "QUEUED"
          ? "Queued..."
          : normalized === "RUNNING"
            ? "Running..."
            : "Run Sales Agent";
    }

    function renderRun(run) {
      const status = text(run?.status, "IDLE").toUpperCase();
      const totals = run?.totals && typeof run.totals === "object" ? run.totals : {};
      elements.status.textContent = status;
      elements.lastRun.textContent = formatDateTime(
        run?.completedAt || run?.startedAt || run?.createdAt
      );
      elements.opportunitiesFound.textContent = String(safeNumber(totals.opportunitiesFound));
      elements.quotesSubmitted.textContent = String(safeNumber(totals.quotesSubmitted));
      elements.manualReview.textContent = String(safeNumber(totals.manualReview));
      elements.skipped.textContent = String(safeNumber(totals.skipped));
      elements.failed.textContent = String(safeNumber(totals.failed));
      elements.openAiCalls.textContent = String(safeNumber(totals.openAiCalls));
      elements.platformActions.textContent = String(safeNumber(totals.platformActions));
      updateButton(status);
    }

    function renderResults(results) {
      elements.resultsTable.replaceChildren();
      if (!Array.isArray(results) || !results.length) {
        const row = documentRef.createElement("tr");
        const cell = documentRef.createElement("td");
        cell.colSpan = 8;
        cell.textContent = "No opportunity results yet.";
        row.appendChild(cell);
        elements.resultsTable.appendChild(row);
        return;
      }
      for (const result of results) {
        const row = documentRef.createElement("tr");
        const values = [
          text(result?.eventName),
          text(result?.opportunityId),
          text(result?.platform).toUpperCase(),
          text(result?.resultStatus || result?.analysisStatus),
          staffText(result?.staffBreakdown),
          formatPrice(result?.finalPrice),
          text(result?.quoteUuid),
          formatDateTime(result?.updatedAt || result?.createdAt)
        ];
        for (const value of values) {
          const cell = documentRef.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        }
        elements.resultsTable.appendChild(row);
      }
    }

    async function requestJson(url, options) {
      const response = await authFetch(url, options);
      const payload = await readPayload(response);
      if (!payload || typeof payload !== "object") {
        throw new Error("Sales Agent returned an invalid response.");
      }
      return { response, payload };
    }

    async function loadRun(runId) {
      if (!runId) return null;
      const detail = await requestJson(`/api/admin/sales-agent/runs/${encodeURIComponent(runId)}`);
      if (!detail.response.ok || detail.payload.success === false || !detail.payload.run) {
        throw new Error("Sales Agent run could not be loaded.");
      }
      const run = detail.payload.run;
      currentRunId = String(run._id || run.id || runId);
      renderRun(run);

      const resultResponse = await requestJson(
        `/api/admin/sales-agent/runs/${encodeURIComponent(currentRunId)}/results`
      );
      if (!resultResponse.response.ok || resultResponse.payload.success === false) {
        throw new Error("Opportunity results could not be loaded.");
      }
      renderResults(resultResponse.payload.results);
      if (TERMINAL_STATUSES.has(String(run.status || "").toUpperCase())) stopPolling();
      return run;
    }

    async function latestRun() {
      const list = await requestJson("/api/admin/sales-agent/runs");
      if (!list.response.ok || list.payload.success === false) {
        throw new Error("Sales Agent runs could not be loaded.");
      }
      const run = Array.isArray(list.payload.runs) ? list.payload.runs[0] : null;
      if (run?._id || run?.id) return loadRun(run._id || run.id);
      currentRunId = "";
      renderRun(null);
      renderResults([]);
      return null;
    }

    async function pollStatus() {
      if (documentRef.hidden) return null;
      const statusResponse = await requestJson("/api/admin/sales-agent/status");
      if (!statusResponse.response.ok || statusResponse.payload.success === false) {
        throw new Error("Sales Agent status could not be loaded.");
      }
      const activeRun = statusResponse.payload.run;
      if (activeRun?._id || activeRun?.id) {
        return loadRun(activeRun._id || activeRun.id);
      }
      if (currentRunId) return loadRun(currentRunId);
      return latestRun();
    }

    function stopPolling() {
      if (pollingTimer !== null) clearIntervalFn(pollingTimer);
      pollingTimer = null;
    }

    function startPolling() {
      if (pollingTimer !== null) return;
      pollingTimer = setIntervalFn(async () => {
        try {
          await pollStatus();
        } catch (_error) {
          stopPolling();
          showRetryError("Sales Agent status could not be refreshed. Please retry.");
        }
      }, 5000);
    }

    async function refresh() {
      clearRetry();
      try {
        const run = await pollStatus();
        if (ACTIVE_STATUSES.has(String(run?.status || "").toUpperCase())) startPolling();
        return run;
      } catch (_error) {
        showRetryError("Sales Agent data could not be loaded. Please retry.");
        return null;
      }
    }

    async function startRun() {
      clearRetry();
      elements.runButton.disabled = true;
      try {
        const created = await requestJson("/api/admin/sales-agent/runs", { method: "POST" });
        if (
          created.response.status === 409 &&
          created.payload.code === "SALES_AGENT_RUN_ALREADY_ACTIVE"
        ) {
          showMessage("A Sales Agent run is already active.", "error");
          const active = await pollStatus();
          if (ACTIVE_STATUSES.has(String(active?.status || "").toUpperCase())) startPolling();
          return active;
        }
        if (!created.response.ok || created.payload.success === false || !created.payload.run) {
          throw new Error("Sales Agent run could not be started.");
        }
        const run = created.payload.run;
        currentRunId = String(run._id || run.id || "");
        renderRun(run);
        renderResults([]);
        startPolling();
        return run;
      } catch (_error) {
        updateButton("IDLE");
        showRetryError("Sales Agent run could not be started. Please retry.");
        return null;
      }
    }

    function onVisibilityChange() {
      if (documentRef.hidden) return;
      refresh();
    }

    async function init() {
      documentRef.addEventListener("visibilitychange", onVisibilityChange);
      return refresh();
    }

    return {
      init,
      refresh,
      startRun,
      pollStatus,
      renderRun,
      renderResults,
      startPolling,
      stopPolling,
      getCurrentRunId: () => currentRunId,
      isPolling: () => pollingTimer !== null
    };
  }

  return {
    createController,
    formatPrice,
    staffText
  };
});
