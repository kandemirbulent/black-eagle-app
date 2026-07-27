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

  function safeOperationalText(value) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    if (
      /(?:mongodb(?:\+srv)?:\/\/|api[_ -]?key|password|credential|cookie|session|private key|bearer\s+[a-z0-9._-]+)/i.test(
        normalized
      ) ||
      /(?:^|\s)at\s+\S+\s+\([^)]*:\d+:\d+\)/i.test(normalized)
    ) {
      return "Sensitive or technical error details were withheld.";
    }
    return normalized;
  }

  function wordSafeLimit(value, limit = 120) {
    const normalized = safeOperationalText(value);
    if (normalized.length <= limit) return normalized;
    const candidate = normalized.slice(0, limit + 1);
    const boundary = candidate.lastIndexOf(" ");
    return `${candidate.slice(0, boundary > 40 ? boundary : limit).trim()}…`;
  }

  function listValues(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) =>
        safeOperationalText(
          typeof item === "string" ? item : item?.reason || item?.message || item?.text
        )
      )
      .filter(Boolean);
  }

  function reviewReason(result) {
    const status = text(result?.resultStatus || result?.analysisStatus, "").toUpperCase();
    const reasons = listValues(result?.blockingReasons);
    if (["SENT", "SUBMITTED", "PENDING", "ACCEPTED", "CONFIRMED", "BOOKED"].includes(status)) {
      return "Quote submitted";
    }
    if (status === "MANUAL_REVIEW") {
      if (!reasons.length) return "Manual review required; no reason was recorded.";
      const suffix = reasons.length > 1 ? ` (+${reasons.length - 1} more)` : "";
      return `${wordSafeLimit(reasons[0], Math.max(40, 120 - suffix.length))}${suffix}`;
    }
    if (status === "FAILED") {
      const safeError = safeOperationalText(result?.errorSummary || result?.error);
      const reason = reasons[0] || safeError;
      return reason
        ? wordSafeLimit(reason)
        : "Processing failed; no safe error summary was recorded.";
    }
    if (status === "SKIPPED") return reasons[0] ? wordSafeLimit(reasons[0]) : "—";
    return reasons[0] ? wordSafeLimit(reasons[0]) : "—";
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
      resultsTable: byId("salesAgentResultsTable"),
      detailsModal: byId("salesAgentDetailsModal"),
      detailsTitle: byId("salesAgentDetailsModalTitle"),
      detailsContent: byId("salesAgentDetailsContent"),
      closeDetailsButton: byId("closeSalesAgentDetailsModal"),
      runSelector: byId("salesAgentRunSelector"),
      resultsNotice: byId("salesAgentResultsNotice")
    };
    let currentRunId = "";
    let currentRun = null;
    let displayedResultsRunId = "";
    let displayedResultsCount = 0;
    let automaticLatestRun = true;
    let runsCache = [];
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

    function createElement(tag, content, className) {
      const element = documentRef.createElement(tag);
      if (className) element.className = className;
      if (content !== undefined) element.textContent = text(content);
      return element;
    }

    function detailCard(label, value) {
      const card = createElement("div", undefined, "sales-agent-detail-card");
      card.appendChild(createElement("strong", label));
      card.appendChild(createElement("div", value));
      return card;
    }

    function detailSection(title, entries) {
      const section = createElement("section", undefined, "sales-agent-detail-section");
      section.appendChild(createElement("h4", title));
      const grid = createElement("div", undefined, "sales-agent-detail-grid");
      for (const [label, value] of entries) grid.appendChild(detailCard(label, value));
      section.appendChild(grid);
      return section;
    }

    function listSection(title, values, fallback) {
      const section = createElement("section", undefined, "sales-agent-detail-section");
      section.appendChild(createElement("h4", title));
      const list = createElement("ul", undefined, "sales-agent-detail-list");
      const safeValues = listValues(values);
      for (const value of safeValues.length ? safeValues : [fallback]) {
        list.appendChild(createElement("li", value));
      }
      section.appendChild(list);
      return section;
    }

    function closeDetails() {
      elements.detailsModal?.classList.add("hidden");
      elements.detailsContent?.replaceChildren();
    }

    function openDetails(result) {
      if (!elements.detailsModal || !elements.detailsContent) return;
      const status = text(result?.resultStatus || result?.analysisStatus, "UNKNOWN").toUpperCase();
      elements.detailsContent.replaceChildren();
      elements.detailsTitle.textContent = text(result?.eventName, "Opportunity Details");

      let bannerText = "";
      let bannerClass = "";
      if (status === "MANUAL_REVIEW") {
        bannerText = "Quote was not submitted because manual review is required.";
        bannerClass = "manual";
      } else if (status === "FAILED") {
        bannerText = "Processing failed. Review the reasons below.";
        bannerClass = "failed";
      } else if (["SENT", "SUBMITTED", "PENDING", "ACCEPTED", "CONFIRMED", "BOOKED"].includes(status)) {
        bannerText = "Quote submitted successfully.";
        bannerClass = "success";
      }
      if (bannerText) {
        elements.detailsContent.appendChild(
          createElement("div", bannerText, `sales-agent-detail-banner ${bannerClass}`)
        );
      }

      elements.detailsContent.appendChild(
        detailSection("Basic Information", [
          ["Event name", result?.eventName],
          ["Opportunity ID", result?.opportunityId],
          ["Platform", text(result?.platform).toUpperCase()],
          ["Event date", formatDateTime(result?.eventDate)],
          ["Location", result?.location],
          ["Analysis status", result?.analysisStatus],
          ["Result status", result?.resultStatus],
          ["Last updated", formatDateTime(result?.updatedAt || result?.createdAt)]
        ])
      );
      elements.detailsContent.appendChild(
        listSection(
          "Why was the quote not submitted?",
          result?.blockingReasons,
          "No blocking reason was recorded."
        )
      );
      elements.detailsContent.appendChild(
        listSection("Agent Assumptions", result?.assumptions, "No assumptions were recorded.")
      );

      const staffing = Array.isArray(result?.staffBreakdown)
        ? result.staffBreakdown
            .map((item) => {
              const role = safeOperationalText(item?.role);
              const quantity = safeNumber(item?.quantity);
              return role && quantity > 0 ? `${role}: ${quantity}` : "";
            })
            .filter(Boolean)
            .join(", ")
        : "";
      elements.detailsContent.appendChild(
        detailSection("Staffing Calculation", [
          ["Roles and staff", staffing || "—"],
          ["Working hours", safeNumber(result?.workingHours)],
          ["Travel hours", safeNumber(result?.travelHours)]
        ])
      );
      elements.detailsContent.appendChild(
        detailSection("Price Breakdown", [
          ["Labour subtotal", formatPrice(result?.labourSubtotal)],
          ["Travel labour", formatPrice(result?.travelLabour)],
          ["Vehicle cost", formatPrice(result?.vehicleCost)],
          ["Parking cost", formatPrice(result?.parkingCost)],
          ["Accommodation cost", formatPrice(result?.accommodationCost)],
          ["Final price", formatPrice(result?.finalPrice)]
        ])
      );
      elements.detailsContent.appendChild(
        detailSection("Quote Status", [
          ["Quote submitted", result?.quoteSubmitted ? "Yes" : "No"],
          ["Quote UUID", result?.quoteUuid],
          ["Platform state", result?.platformState],
          ["AI call used", result?.aiCallUsed ? "Yes" : "No"]
        ])
      );
      elements.detailsModal.classList.remove("hidden");
    }

    function renderResults(results) {
      elements.resultsTable.replaceChildren();
      displayedResultsCount = Array.isArray(results) ? results.length : 0;
      if (!Array.isArray(results) || !results.length) {
        const row = documentRef.createElement("tr");
        const cell = documentRef.createElement("td");
        cell.colSpan = 10;
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
          reviewReason(result),
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
        const actionCell = documentRef.createElement("td");
        const detailsButton = createElement("button", "View Details", "button secondary sales-agent-action-button");
        detailsButton.type = "button";
        detailsButton.addEventListener("click", () => openDetails(result));
        actionCell.appendChild(detailsButton);
        row.appendChild(actionCell);
        elements.resultsTable.appendChild(row);
      }
    }

    function setResultsNotice(message) {
      if (!elements.resultsNotice) return;
      elements.resultsNotice.textContent = text(message, "");
      elements.resultsNotice.classList.toggle("hidden", !message);
    }

    function getRunId(run) {
      return String(run?._id || run?.id || "");
    }

    function runOptionText(run) {
      const totals = run?.totals && typeof run.totals === "object" ? run.totals : {};
      const date = formatDateTime(run?.completedAt || run?.startedAt || run?.createdAt);
      const status = text(run?.status, "UNKNOWN").toUpperCase();
      return `${date} — ${status} — ${safeNumber(totals.opportunitiesFound)} found / ${safeNumber(totals.quotesSubmitted)} submitted / ${safeNumber(totals.manualReview)} review`;
    }

    function renderRunHistory(runs) {
      runsCache = Array.isArray(runs) ? runs.slice(0, 20) : [];
      if (!elements.runSelector) return;
      const latestOption = documentRef.createElement("option");
      latestOption.value = "";
      latestOption.textContent = "Latest Run";
      const options = [latestOption];
      for (const run of runsCache) {
        const id = getRunId(run);
        if (!id) continue;
        const option = documentRef.createElement("option");
        option.value = id;
        option.textContent = runOptionText(run);
        options.push(option);
      }
      elements.runSelector.replaceChildren(...options);
      elements.runSelector.value = automaticLatestRun ? "" : displayedResultsRunId;
    }

    async function requestJson(url, options) {
      const response = await authFetch(url, options);
      const payload = await readPayload(response);
      if (!payload || typeof payload !== "object") {
        throw new Error("Sales Agent returned an invalid response.");
      }
      return { response, payload };
    }

    async function loadRunRecord(id, canonicalLatest = false) {
      if (!id) return null;
      const detail = await requestJson(`/api/admin/sales-agent/runs/${encodeURIComponent(id)}`);
      if (!detail.response.ok || detail.payload.success === false || !detail.payload.run) {
        throw new Error("Sales Agent run could not be loaded.");
      }
      const run = detail.payload.run;
      const resolvedId = getRunId(run) || String(id);
      const resultResponse = await requestJson(
        `/api/admin/sales-agent/runs/${encodeURIComponent(resolvedId)}/results${canonicalLatest ? "?canonicalLatest=true" : ""}`
      );
      if (!resultResponse.response.ok || resultResponse.payload.success === false) {
        throw new Error("Opportunity results could not be loaded.");
      }
      return {
        run,
        results: Array.isArray(resultResponse.payload.results)
          ? resultResponse.payload.results
          : []
      };
    }

    async function loadRunHistory() {
      const list = await requestJson("/api/admin/sales-agent/runs");
      if (!list.response.ok || list.payload.success === false) {
        throw new Error("Sales Agent runs could not be loaded.");
      }
      renderRunHistory(Array.isArray(list.payload.runs) ? list.payload.runs : []);
      return runsCache;
    }

    async function showPreviousResults(status) {
      if (displayedResultsRunId && displayedResultsRunId !== currentRunId && displayedResultsCount) {
        setResultsNotice(
          `Current run is ${status}. Showing results from the previous completed run.`
        );
        return;
      }
      const candidates = runsCache.filter((run) => {
        const candidateStatus = text(run?.status, "").toUpperCase();
        return (
          getRunId(run) !== currentRunId &&
          TERMINAL_STATUSES.has(candidateStatus)
        );
      });
      for (const candidate of candidates) {
        const record = await loadRunRecord(getRunId(candidate), true);
        if (record?.results.length) {
          displayedResultsRunId = getRunId(record.run);
          renderResults(record.results);
          setResultsNotice(
            `Current run is ${status}. Showing results from the previous completed run.`
          );
          return;
        }
      }
      displayedResultsRunId = currentRunId;
      renderResults([]);
      setResultsNotice("");
    }

    async function loadCurrentRun(id) {
      const record = await loadRunRecord(id, true);
      if (!record) return null;
      currentRun = record.run;
      currentRunId = getRunId(record.run) || String(id);
      const status = text(record.run?.status, "IDLE").toUpperCase();
      if (automaticLatestRun) renderRun(record.run);
      if (automaticLatestRun && record.results.length) {
        displayedResultsRunId = currentRunId;
        renderResults(record.results);
        setResultsNotice("");
      } else if (automaticLatestRun && ACTIVE_STATUSES.has(status)) {
        await showPreviousResults(status);
      } else if (automaticLatestRun) {
        displayedResultsRunId = currentRunId;
        renderResults(record.results);
        setResultsNotice("");
      }
      if (!automaticLatestRun) updateButton(status);
      if (TERMINAL_STATUSES.has(status)) stopPolling();
      return record.run;
    }

    async function loadSelectedRun(id) {
      const record = await loadRunRecord(id);
      if (!record) return null;
      displayedResultsRunId = getRunId(record.run) || String(id);
      renderRun(record.run);
      renderResults(record.results);
      setResultsNotice("");
      updateButton(currentRun?.status);
      return record.run;
    }

    async function latestRun() {
      if (!runsCache.length) await loadRunHistory();
      const run = runsCache[0] || null;
      if (getRunId(run)) return loadCurrentRun(getRunId(run));
      currentRunId = "";
      currentRun = null;
      renderRun(null);
      renderResults([]);
      setResultsNotice("");
      return null;
    }

    async function pollStatus() {
      if (documentRef.hidden) return null;
      const statusResponse = await requestJson("/api/admin/sales-agent/status");
      if (!statusResponse.response.ok || statusResponse.payload.success === false) {
        throw new Error("Sales Agent status could not be loaded.");
      }
      const activeRun = statusResponse.payload.run;
      if (getRunId(activeRun)) {
        return loadCurrentRun(getRunId(activeRun));
      }
      if (currentRunId) return loadCurrentRun(currentRunId);
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
        await loadRunHistory();
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
        currentRun = run;
        currentRunId = getRunId(run);
        automaticLatestRun = true;
        renderRunHistory([
          run,
          ...runsCache.filter((cachedRun) => getRunId(cachedRun) !== currentRunId)
        ]);
        renderRun(run);
        if (displayedResultsCount && displayedResultsRunId !== currentRunId) {
          setResultsNotice(
            `Current run is ${text(run?.status, "QUEUED").toUpperCase()}. Showing results from the previous completed run.`
          );
        }
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

    function onKeyDown(event) {
      if (event?.key === "Escape" && !elements.detailsModal?.classList.contains("hidden")) {
        closeDetails();
      }
    }

    async function onRunSelectionChange() {
      const selectedRunId = String(elements.runSelector?.value || "");
      if (!selectedRunId) {
        automaticLatestRun = true;
        await refresh();
        return;
      }
      automaticLatestRun = false;
      try {
        await loadSelectedRun(selectedRunId);
      } catch (_error) {
        showRetryError("The selected Sales Agent run could not be loaded. Please retry.");
      }
    }

    async function init() {
      documentRef.addEventListener("visibilitychange", onVisibilityChange);
      documentRef.addEventListener("keydown", onKeyDown);
      elements.closeDetailsButton?.addEventListener("click", closeDetails);
      elements.runSelector?.addEventListener("change", onRunSelectionChange);
      return refresh();
    }

    return {
      init,
      refresh,
      startRun,
      pollStatus,
      renderRun,
      renderResults,
      renderRunHistory,
      loadSelectedRun,
      openDetails,
      closeDetails,
      startPolling,
      stopPolling,
      getCurrentRunId: () => currentRunId,
      getDisplayedResultsRunId: () => displayedResultsRunId,
      isPolling: () => pollingTimer !== null
    };
  }

  return {
    createController,
    formatPrice,
    staffText,
    reviewReason,
    wordSafeLimit
  };
});
