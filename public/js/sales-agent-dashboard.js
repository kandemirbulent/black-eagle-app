(function attachSalesAgentDashboard(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SalesAgentDashboard = api;
})(typeof window !== "undefined" ? window : globalThis, function salesAgentDashboardFactory() {
  const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);
  const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELED"]);

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

  function formatPlatform(value) {
    const platform = String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
    if (platform === "addtoevent") return "Add to Event";
    if (platform === "togather") return "Togather";
    if (platform === "poptop") return "Poptop";
    return text(value);
  }

  function formatCredits(result) {
    const platform = String(result?.platform || "").toLowerCase().replace(/[\s_-]+/g, "");
    if (platform !== "addtoevent") return "—";
    const estimate = result?.platformCostEstimate;
    const amount = Number(estimate?.amount);
    return String(estimate?.status || "").toUpperCase() === "KNOWN" && Number.isFinite(amount) && amount >= 0
      ? `${amount} credits`
      : "UNKNOWN";
  }

  function safeOperationalText(value) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    if (
      /(?:mongodb(?:\+srv)?:\/\/|bearer\s+[a-z0-9._-]+|(?:api[_ -]?key|password|credential|cookie|session|private key)\s*[:=]\s*\S+)/i.test(
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
    clearIntervalFn = clearInterval,
    confirmFn = null
  }) {
    const byId = (id) => documentRef.getElementById(id);
    function diagnosticElement(id, label) {
      const existing = byId(id);
      if (existing) return existing;
      const grid = byId("salesAgentCurrentStatus")?.closest?.(".stats-grid");
      if (!grid) return null;
      const card = documentRef.createElement("div");
      card.className = "stat-card";
      const heading = documentRef.createElement("span");
      heading.textContent = label;
      const value = documentRef.createElement("strong");
      value.id = id;
      value.textContent = "—";
      card.appendChild(heading);
      card.appendChild(value);
      grid.appendChild(card);
      return value;
    }
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
      failedStage: diagnosticElement("salesAgentFailedStage", "Failed Stage"),
      failureReason: diagnosticElement("salesAgentFailureReason", "Failure Reason"),
      errorMessage: diagnosticElement("salesAgentErrorMessage", "Error Message"),
      runButton: byId("runSalesAgentButton"),
      manualReviewButton: byId("submitManualReviewsButton"),
      viewCurrentPartialButton: byId("viewCurrentSalesAgentPartialResults"),
      cancelRunButton: byId("cancelCurrentSalesAgentRun"),
      manualSelectedRun: byId("manualReviewSelectedRun"),
      manualCount: byId("manualReviewSelectedCount"),
      manualStatus: byId("manualReviewSubmissionStatus"),
      manualProcessed: byId("manualReviewProcessed"),
      manualSubmitted: byId("manualReviewSubmitted"),
      manualAlreadyQuoted: byId("manualReviewAlreadyQuoted"),
      manualRemaining: byId("manualReviewRemaining"),
      manualFailed: byId("manualReviewFailedItems"),
      retryButton: byId("retrySalesAgentButton"),
      resultsTable: byId("salesAgentResultsTable"),
      detailsModal: byId("salesAgentDetailsModal"),
      detailsTitle: byId("salesAgentDetailsModalTitle"),
      detailsContent: byId("salesAgentDetailsContent"),
      closeDetailsButton: byId("closeSalesAgentDetailsModal"),
      runSelector: byId("salesAgentRunSelector"),
      resultsNotice: byId("salesAgentResultsNotice"),
      platformFilter: byId("salesAgentPlatformFilter"),
      selectCurrentPage: byId("selectCurrentOpportunityPage"),
      clearSelection: byId("clearOpportunitySelection"),
      selectedCount: byId("selectedOpportunityCount"),
      previewSelected: byId("previewSelectedOpportunities"),
      holdSelected: byId("holdSelectedOpportunities"),
      rejectSelected: byId("rejectSelectedOpportunities"),
      editSelected: byId("editSelectedOpportunity"),
      submitSelected: byId("submitSelectedOpportunities")
    };
    let currentRunId = "";
    let currentRun = null;
    let displayedResultsRunId = "";
    let displayedResultsCount = 0;
    let displayedManualReviewCount = 0;
    let automaticLatestRun = true;
    let runsCache = [];
    let pollingTimer = null;
    let manualPollingTimer = null;
    let currentResults = [];
    let cancellationInProgress = false;
    let submissionInProgress = false;
    let pendingDetailsConfirmation = null;
    const selectedOpportunities = new Map();

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
      if (elements.failedStage) elements.failedStage.textContent = safeOperationalText(run?.failedStage) || "—";
      if (elements.failureReason) elements.failureReason.textContent = wordSafeLimit(run?.failureReason, 180) || "—";
      if (elements.errorMessage) elements.errorMessage.textContent = wordSafeLimit(run?.errorMessage || run?.errorSummary, 180) || "—";
      updateButton(status);
      if (elements.viewCurrentPartialButton) {
        const hasPartial = ACTIVE_STATUSES.has(status) && safeNumber(run?.persistedResultCount) > 0;
        elements.viewCurrentPartialButton.classList.toggle("hidden", !hasPartial);
      }
      if (elements.cancelRunButton) {
        elements.cancelRunButton.classList.toggle("hidden", !ACTIVE_STATUSES.has(status));
        elements.cancelRunButton.disabled = cancellationInProgress || !ACTIVE_STATUSES.has(status);
      }
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
      pendingDetailsConfirmation?.(false);
      pendingDetailsConfirmation = null;
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
          ["Platform", formatPlatform(result?.platform)],
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
          ["Customer quote", formatPrice(result?.finalPrice)],
          ["Credits required", formatCredits(result)]
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

    function visibleResults() {
      const platform = String(elements.platformFilter?.value || "").toLowerCase();
      return platform
        ? currentResults.filter((result) => String(result?.platform || "").toLowerCase().replace(/[\s_-]+/g, "") === platform)
        : currentResults;
    }

    function selectedReferences() {
      return [...selectedOpportunities.values()].map((item) => ({ id: item.id, expectedVersion: item.expectedVersion }));
    }

    function updateSelectionToolbar() {
      const count = selectedOpportunities.size;
      if (elements.selectedCount) elements.selectedCount.textContent = `${count} selected`;
      for (const button of [elements.previewSelected, elements.holdSelected, elements.rejectSelected, elements.submitSelected]) {
        if (button) button.disabled = count === 0;
      }
      if (elements.editSelected) elements.editSelected.disabled = count !== 1;
      if (elements.clearSelection) elements.clearSelection.disabled = count === 0;
    }

    async function persistOpportunitySelection(result, selected) {
      const id = String(result?._id || "");
      const expectedVersion = Number(result?.recordVersion);
      if (!id || !Number.isInteger(expectedVersion)) return false;
      const response = await requestJson("/api/admin/sales-agent/opportunities/selection", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ id, expectedVersion }], selected })
      });
      if (!response.response.ok || response.payload.success === false) return false;
      result.selectedVersion = selected ? expectedVersion : null;
      if (selected) selectedOpportunities.set(id, { id, expectedVersion, result });
      else selectedOpportunities.delete(id);
      updateSelectionToolbar();
      return true;
    }

    async function clearOpportunitySelection() {
      const selected = [...selectedOpportunities.values()];
      await Promise.all(selected.map((item) => persistOpportunitySelection(item.result, false)));
      renderResults(currentResults, { preserveSelection: true });
    }

    async function selectAllCurrentPage() {
      for (const result of visibleResults()) {
        const id = String(result?._id || "");
        if (id && result?.manualSelectionEligible === true && !selectedOpportunities.has(id)) await persistOpportunitySelection(result, true);
      }
      renderResults(currentResults, { preserveSelection: true });
    }

    function renderResults(results, { preserveSelection = false } = {}) {
      currentResults = Array.isArray(results) ? results : [];
      if (!preserveSelection) {
        selectedOpportunities.clear();
        for (const result of currentResults) {
          const id = String(result?._id || "");
          const version = Number(result?.recordVersion);
          if (id && Number(result?.selectedVersion) === version && result?.manualSelectionEligible === true) {
            selectedOpportunities.set(id, { id, expectedVersion: version, result });
          }
        }
      }
      elements.resultsTable.replaceChildren();
      displayedResultsCount = currentResults.length;
      displayedManualReviewCount = currentResults.length
        ? currentResults.filter((result) => String(result?.resultStatus || "").toUpperCase() === "MANUAL_REVIEW").length
        : 0;
      if (elements.manualSelectedRun) elements.manualSelectedRun.textContent = displayedResultsRunId || "—";
      if (elements.manualCount) elements.manualCount.textContent = String(displayedManualReviewCount);
      if (elements.manualReviewButton && !ACTIVE_STATUSES.has(String(elements.manualStatus?.textContent || "").toUpperCase())) {
        elements.manualReviewButton.disabled = !displayedResultsRunId || displayedManualReviewCount === 0;
      }
      const resultsToRender = visibleResults();
      if (!resultsToRender.length) {
        const row = documentRef.createElement("tr");
        const cell = documentRef.createElement("td");
        cell.colSpan = 12;
        cell.textContent = "No opportunity results yet.";
        row.appendChild(cell);
        elements.resultsTable.appendChild(row);
        updateSelectionToolbar();
        return;
      }
      for (const result of resultsToRender) {
        const row = documentRef.createElement("tr");
        const selectionCell = documentRef.createElement("td");
        const checkbox = documentRef.createElement("input");
        const recordId = String(result?._id || "");
        checkbox.type = "checkbox";
        checkbox.checked = selectedOpportunities.has(recordId);
        checkbox.disabled = result?.manualSelectionEligible !== true;
        checkbox.title = result?.manualSelectionBlocker || "Select opportunity";
        checkbox.setAttribute?.("aria-label", `Select opportunity ${text(result?.opportunityId)}`);
        checkbox.addEventListener("change", async () => {
          const requested = checkbox.checked && !checkbox.disabled;
          checkbox.disabled = true;
          const saved = await persistOpportunitySelection(result, requested).catch(() => false);
          if (!saved) checkbox.checked = !requested;
          checkbox.disabled = result?.manualSelectionEligible !== true;
          updateSelectionToolbar();
        });
        selectionCell.appendChild(checkbox);
        row.appendChild(selectionCell);
        const values = [
          text(result?.eventName),
          text(result?.opportunityId),
          formatPlatform(result?.platform),
          text(result?.resultStatus || result?.analysisStatus),
          reviewReason(result),
          staffText(result?.staffBreakdown),
          formatPrice(result?.manualOverrides?.finalPrice ?? result?.finalPrice),
          formatCredits(result),
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
        if (String(result?.platform || "").toLowerCase() === "addtoevent" && String(result?.resultStatus || "").toUpperCase() === "MANUAL_REVIEW") {
          const editButton = createElement("button", "Edit Quote", "button secondary sales-agent-action-button");
          editButton.type = "button";
          editButton.addEventListener("click", () => editOpportunity(result));
          actionCell.appendChild(editButton);
        }
        row.appendChild(actionCell);
        elements.resultsTable.appendChild(row);
      }
      updateSelectionToolbar();
    }

    function renderSelectionPreview(preview, submitPlaceholder = false) {
      elements.detailsContent.replaceChildren();
      elements.detailsTitle.textContent = submitPlaceholder ? "Submit Selected Quotes" : "Selected Opportunity Preview";
      elements.detailsContent.appendChild(detailSection("Selection", [
        ["Selected count", preview?.selectedCount],
        ["Opportunity IDs", (preview?.opportunityIds || []).join(", ") || "—"],
        ["Platform breakdown", Object.entries(preview?.platformBreakdown || {}).map(([key, value]) => `${key}: ${value}`).join(", ") || "—"],
        ["Combined quotation value", formatPrice(preview?.combinedQuotationValue)],
        ["Estimated platform cost", `${safeNumber(preview?.estimatedCredits)} credits`],
        ["Estimated revenue", formatPrice(preview?.estimatedRevenue)],
        ["Estimated profit", formatPrice(preview?.estimatedProfit)]
      ]));
      elements.detailsContent.appendChild(createElement("p", "Unselected opportunities will not be touched."));
      elements.detailsContent.appendChild(createElement("p", submitPlaceholder
        ? "Only these explicitly selected READY Add to Event opportunities can be submitted."
        : "Preview only. No quote or paid action has occurred."));
      elements.detailsModal.classList.remove("hidden");
    }

    async function previewSelection(submitPlaceholder = false) {
      const result = await requestJson("/api/admin/sales-agent/opportunities/selection-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: selectedReferences() })
      });
      if (!result.response.ok || !result.payload.preview) {
        showMessage("Selected opportunities could not be previewed. Refresh and try again.", "error");
        return null;
      }
      renderSelectionPreview(result.payload.preview, submitPlaceholder);
      return result.payload.preview;
    }

    function confirmSelectedSubmission(message) {
      if (typeof confirmFn === "function") return Promise.resolve(confirmFn(message));
      return new Promise((resolve) => {
        let settled = false;
        const settle = (confirmed) => {
          if (settled) return;
          settled = true;
          pendingDetailsConfirmation = null;
          resolve(confirmed);
        };
        pendingDetailsConfirmation = settle;
        const actions = createElement("div", undefined, "sales-agent-detail-actions");
        const cancelButton = createElement("button", "Cancel", "button secondary");
        cancelButton.type = "button";
        cancelButton.addEventListener("click", () => settle(false));
        const confirmButton = createElement("button", "Confirm Submission", "button primary");
        confirmButton.type = "button";
        confirmButton.addEventListener("click", () => {
          confirmButton.disabled = true;
          settle(true);
        });
        actions.appendChild(cancelButton);
        actions.appendChild(confirmButton);
        elements.detailsContent.appendChild(createElement("p", message));
        elements.detailsContent.appendChild(actions);
      });
    }

    async function submitSelectedOpportunities() {
      if (submissionInProgress) return null;
      submissionInProgress = true;
      if (elements.submitSelected) elements.submitSelected.disabled = true;
      try {
        const preview = await previewSelection(true);
        if (!preview || preview.blocked?.length || preview.selectedCount !== selectedOpportunities.size) return null;
        const confirmation = `Submit ${preview.selectedCount} selected Add to Event quotes? Estimated cost: ${safeNumber(preview.estimatedCredits)} credits. This may consume platform credits.`;
        if (!await confirmSelectedSubmission(confirmation)) return null;
        const result = await requestJson("/api/admin/sales-agent/opportunities/submit-selected", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: selectedReferences() })
        });
        if (!result.response.ok || result.payload.success === false) {
          showMessage("Selected quotes were not queued. Refresh and review the current versions.", "error");
          return null;
        }
        selectedOpportunities.clear();
        closeDetails();
        showMessage(`${result.payload.selectedCount} selected quotes queued with an estimated cost of ${safeNumber(result.payload.estimatedCredits)} credits.`);
        await refresh();
        return result.payload;
      } finally {
        submissionInProgress = false;
        updateSelectionToolbar();
      }
    }

    async function updateSelectedStatus(targetStatus) {
      if (targetStatus === "REJECTED" && !confirmFn(`Reject ${selectedOpportunities.size} selected opportunities?`)) return null;
      const result = await requestJson("/api/admin/sales-agent/opportunities/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: selectedReferences(), targetStatus })
      });
      selectedOpportunities.clear();
      await refresh();
      if (result.payload.outcomes?.some((item) => !item.success)) showMessage("Some opportunities were not updated. The latest data has been loaded.", "error");
      return result.payload;
    }

    async function editOpportunity(reference) {
      const id = String(reference?.id || reference?._id || "");
      if (!id) return null;
      const response = await requestJson(`/api/admin/sales-agent/opportunities/${encodeURIComponent(id)}`);
      if (!response.response.ok || !response.payload.opportunity) return null;
      const opportunity = response.payload.opportunity;
      const saveAndApprove = String(opportunity.platform || "").toLowerCase() === "addtoevent"
        && String(opportunity.resultStatus || "").toUpperCase() === "MANUAL_REVIEW";
      openDetails(opportunity);
      const form = createElement("form", undefined, "sales-agent-edit-form");
      const fields = [
        ["guestCount", "Guest count", "number"], ["startTime", "Start time", "time"],
        ["endTime", "End time", "time"], ["durationHours", "Duration (hours)", "number"],
        ["requestedRoles", "Requested roles", "text"], ["staffBreakdown", "Staff quantities (Role: quantity)", "text"],
        ["travelCharge", "Travel charge", "number"], ["finalPrice", "Final price", "number"],
        ["discountType", "Discount type", "text"], ["discountValue", "Discount amount/percentage", "number"],
        ["discountReason", "Discount reason", "text"], ["customerMessage", "Customer message", "text"]
      ];
      const manual = opportunity.manualOverrides || {};
      const canonicalStaff = Array.isArray(opportunity.staffBreakdown) ? opportunity.staffBreakdown : [];
      const currentValue = (key) => {
        if (key === "requestedRoles") {
          return Array.isArray(manual.requestedRoles) && manual.requestedRoles.length
            ? manual.requestedRoles
            : canonicalStaff.map((item) => item.role).filter(Boolean);
        }
        if (key === "staffBreakdown") {
          return Array.isArray(manual.staffBreakdown) && manual.staffBreakdown.length
            ? manual.staffBreakdown
            : canonicalStaff;
        }
        if (manual[key] !== undefined && manual[key] !== null && manual[key] !== "") return manual[key];
        if (key === "durationHours") return opportunity.workingHours ?? "";
        if (key === "travelCharge") {
          if (opportunity.travelCharge !== undefined && opportunity.travelCharge !== null) return opportunity.travelCharge;
          return ["travelLabour", "vehicleCost", "parkingCost", "accommodationCost"]
            .map((field) => Number(opportunity[field]))
            .filter(Number.isFinite)
            .reduce((total, value) => total + value, 0);
        }
        if (key === "finalPrice") return opportunity.quoteSnapshot?.calculatedPrice || opportunity.finalPrice || "";
        return opportunity[key] ?? "";
      };
      const inputs = {};
      for (const [key, label, type] of fields) {
        const wrapper = createElement("label", label);
        const input = documentRef.createElement(key === "customerMessage" ? "textarea" : "input");
        input.type = type;
        const value = currentValue(key);
        input.value = key === "requestedRoles"
          ? value.join(", ")
          : key === "staffBreakdown"
            ? value.map((item) => `${item.role}: ${item.quantity}`).join(", ")
            : value;
        wrapper.appendChild(input);
        form.appendChild(wrapper);
        inputs[key] = input;
      }
      const save = createElement("button", saveAndApprove ? "Save & Approve" : "Save Quote Changes", "btn btn-primary");
      save.type = "submit";
      form.appendChild(save);
      form.addEventListener("submit", async (event) => {
        event?.preventDefault?.();
        const body = { expectedVersion: Number(opportunity.recordVersion) };
        if (saveAndApprove) body.saveAndApprove = true;
        for (const [key, , type] of fields) {
          const value = String(inputs[key].value ?? "").trim();
          if (!value) continue;
          const parsed = key === "requestedRoles"
            ? value.split(",").map((item) => item.trim()).filter(Boolean)
            : key === "staffBreakdown"
              ? value.split(",").map((item) => {
                  const [role, quantity] = item.split(":");
                  return { role: String(role || "").trim(), quantity: Number(quantity) };
                }).filter((item) => item.role && Number.isFinite(item.quantity) && item.quantity >= 0)
              : type === "number" && value !== "" ? Number(value) : value;
          const original = currentValue(key);
          if (JSON.stringify(parsed) !== JSON.stringify(original)) body[key] = parsed;
        }
        if (Object.keys(body).length === (saveAndApprove ? 2 : 1)) { showMessage("No quote changes were made.", "error"); return; }
        const saved = await requestJson(`/api/admin/sales-agent/opportunities/${encodeURIComponent(id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        if (saved.response.status === 409 && saved.payload.code === "OPPORTUNITY_VERSION_CONFLICT") {
          showMessage("This opportunity changed after the modal opened. Reload the latest version before editing.", "error");
          return;
        }
        if (!saved.response.ok) { showMessage("Quote changes could not be saved.", "error"); return; }
        selectedOpportunities.clear();
        closeDetails();
        await refresh();
      });
      elements.detailsContent.appendChild(form);
      return opportunity;
    }

    async function editSelectedOpportunity() {
      if (selectedOpportunities.size !== 1) return null;
      return editOpportunity([...selectedOpportunities.values()][0]);
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
      const latestRunId = getRunId(runsCache[0]);
      const latestOption = documentRef.createElement("option");
      latestOption.value = latestRunId;
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
      elements.runSelector.value = automaticLatestRun ? latestRunId : displayedResultsRunId;
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
      if (displayedResultsRunId !== currentRunId && displayedResultsCount) {
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

    function interruptedRunNotice(run, resultCount) {
      const status = text(run?.status, "").toUpperCase();
      if (!["FAILED", "CANCELED"].includes(status)) return "";
      if (!resultCount) return status === "CANCELED"
        ? "This run was canceled. No persisted results were recovered."
        : "This run did not complete. No persisted results were recovered.";
      const page = safeNumber(run?.lastCheckpointPage);
      const checkpointAt = run?.lastCheckpointAt ? formatDateTime(run.lastCheckpointAt) : "";
      return [
        "This run did not complete. Showing results saved before interruption.",
        `Persisted results: ${resultCount}.`,
        page ? `Last checkpoint page: ${page}.` : "",
        checkpointAt ? `Last checkpoint: ${checkpointAt}.` : "",
      ].filter(Boolean).join(" ");
    }

    async function loadCurrentRun(id) {
      const record = await loadRunRecord(id, true);
      if (!record) return null;
      const previousStatus = text(currentRun?.status, "IDLE").toUpperCase();
      currentRun = record.run;
      currentRunId = getRunId(record.run) || String(id);
      const status = text(record.run?.status, "IDLE").toUpperCase();
      if (automaticLatestRun) renderRun(record.run);
      if (automaticLatestRun && ACTIVE_STATUSES.has(status)) {
        await showPreviousResults(status);
      } else if (automaticLatestRun) {
        displayedResultsRunId = currentRunId;
        renderResults(record.results);
        setResultsNotice(interruptedRunNotice(record.run, record.results.length));
      }
      if (!automaticLatestRun) updateButton(status);
      if (TERMINAL_STATUSES.has(status)) {
        stopPolling();
        if (
          status === "FAILED" &&
          record.run?.failureCode === "WORKER_NOT_AVAILABLE" &&
          ACTIVE_STATUSES.has(previousStatus)
        ) {
          showMessage(
            "Previous run expired because no worker was available. You can start a new run.",
            "error"
          );
        }
      }
      return record.run;
    }

    async function loadSelectedRun(id) {
      const record = await loadRunRecord(id);
      if (!record) return null;
      displayedResultsRunId = getRunId(record.run) || String(id);
      renderRun(record.run);
      renderResults(record.results);
      const status = text(record.run?.status, "").toUpperCase();
      setResultsNotice(interruptedRunNotice(record.run, record.results.length));
      updateButton(currentRun?.status);
      return record.run;
    }

    async function viewCurrentPartialResults() {
      if (!currentRunId) return null;
      const record = await loadRunRecord(currentRunId);
      displayedResultsRunId = currentRunId;
      renderResults(record?.results || []);
      const count = record?.results?.length || 0;
      setResultsNotice(count
        ? `Showing current run partial results. Recovered persisted results: ${count}`
        : "No persisted results were recovered.");
      return record;
    }

    async function cancelCurrentRun() {
      const runId = currentRunId;
      const status = text(currentRun?.status, "").toUpperCase();
      if (!runId || !ACTIVE_STATUSES.has(status) || cancellationInProgress) return null;
      const confirmation = [
        `Run ID: ${runId}`,
        "Active processing will stop.",
        "Already submitted quotations will not be reversed.",
        "Already persisted results will be preserved.",
        "Unprocessed opportunities will remain unprocessed.",
      ].join("\n");
      if (!confirmFn(confirmation)) return null;
      cancellationInProgress = true;
      if (elements.cancelRunButton) elements.cancelRunButton.disabled = true;
      try {
        const result = await requestJson(`/api/admin/sales-agent/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
        if (!result.response.ok || result.payload.success === false || !result.payload.run) {
          showMessage(result.payload.message || "The current Sales Agent run could not be canceled.", "error");
          return null;
        }
        currentRun = result.payload.run;
        renderRun(currentRun);
        stopPolling();
        if (safeNumber(currentRun.persistedResultCount) > 0) await loadCurrentRun(runId);
        else setResultsNotice("This run was canceled. No persisted results were recovered.");
        return currentRun;
      } catch (_error) {
        showMessage("The current Sales Agent run could not be canceled.", "error");
        return null;
      } finally {
        cancellationInProgress = false;
        if (elements.cancelRunButton) elements.cancelRunButton.disabled = !ACTIVE_STATUSES.has(text(currentRun?.status, "").toUpperCase());
      }
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
        if (created.payload.code === "WORKER_TRIGGER_FAILED") {
          if (created.payload.run) renderRun(created.payload.run);
          const renderError = wordSafeLimit(created.payload.message, 180);
          showRetryError(renderError || "Sales Agent worker could not be started. Please retry.");
          return created.payload.run || null;
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

    function renderManualReviewRun(run) {
      const status = text(run?.status, "IDLE").toUpperCase();
      const totals = run?.manualReviewResume && typeof run.manualReviewResume === "object"
        ? run.manualReviewResume
        : {};
      if (elements.manualStatus) elements.manualStatus.textContent = status;
      if (elements.manualProcessed) elements.manualProcessed.textContent = String(safeNumber(totals.processed));
      if (elements.manualSubmitted) elements.manualSubmitted.textContent = String(safeNumber(totals.submitted));
      if (elements.manualAlreadyQuoted) elements.manualAlreadyQuoted.textContent = String(safeNumber(totals.alreadyQuoted));
      if (elements.manualRemaining) elements.manualRemaining.textContent = String(safeNumber(totals.remainingManualReview));
      if (elements.manualFailed) elements.manualFailed.textContent = String(safeNumber(totals.failedItems));
      if (elements.manualReviewButton) {
        elements.manualReviewButton.disabled = ACTIVE_STATUSES.has(status)
          || !displayedResultsRunId
          || displayedManualReviewCount === 0;
        elements.manualReviewButton.textContent = status === "QUEUED"
          ? "Manual Reviews Queued..."
          : status === "RUNNING"
            ? "Submitting Manual Reviews..."
            : "Submit Manual Reviews";
      }
    }

    async function pollManualReviewStatus() {
      if (!displayedResultsRunId || documentRef.hidden) return null;
      const result = await requestJson(
        `/api/admin/sales-agent/manual-review-runs/status?sourceRunId=${encodeURIComponent(displayedResultsRunId)}`
      );
      if (!result.response.ok || result.payload.success === false) return null;
      renderManualReviewRun(result.payload.run);
      if (!ACTIVE_STATUSES.has(String(result.payload.run?.status || "").toUpperCase())) stopManualPolling();
      return result.payload.run || null;
    }

    function stopManualPolling() {
      if (manualPollingTimer !== null) clearIntervalFn(manualPollingTimer);
      manualPollingTimer = null;
    }

    function startManualPolling() {
      if (manualPollingTimer !== null) return;
      manualPollingTimer = setIntervalFn(async () => {
        try {
          await pollManualReviewStatus();
        } catch (_error) {
          stopManualPolling();
          showMessage("Manual review submission status could not be refreshed.", "error");
        }
      }, 5000);
    }

    async function submitManualReviews() {
      const sourceRunId = String(elements.runSelector?.value || "").trim();
      const selectedRun = runsCache.find((run) => getRunId(run) === sourceRunId);
      const selectedManualReviewCount = safeNumber(selectedRun?.totals?.manualReview);
      if (!sourceRunId || sourceRunId !== displayedResultsRunId || selectedManualReviewCount === 0) {
        showMessage("Select a run containing MANUAL_REVIEW records.", "error");
        return null;
      }
      console.log(`MANUAL_REVIEW_SELECTED_RUN frontend=${sourceRunId}`);
      const confirmation = [
        `Selected Run: ${sourceRunId}`,
        `Manual Review count: ${selectedManualReviewCount}`,
        "Discovery WILL NOT run",
        "OpenAI WILL NOT run",
        "Eligible quotations WILL be submitted",
      ].join("\n");
      if (!confirmFn(confirmation)) return null;
      const confirmedRunId = String(elements.runSelector?.value || "").trim();
      if (confirmedRunId !== sourceRunId) {
        showMessage("The selected run changed. Please confirm the manual reviews again.", "error");
        return null;
      }
      elements.manualReviewButton.disabled = true;
      try {
        const created = await requestJson("/api/admin/sales-agent/manual-review-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceRunId: confirmedRunId }),
        });
        if (!created.response.ok || created.payload.success === false || !created.payload.run) {
          const message = created.payload.code === "MANUAL_REVIEW_RESUME_ALREADY_ACTIVE"
            ? "A manual review submission is already active for this run."
            : created.payload.code === "NO_MANUAL_REVIEW_RECORDS"
              ? "The selected run has no remaining MANUAL_REVIEW records. No job was started."
              : created.payload.code === "MANUAL_REVIEW_SOURCE_RUN_MISMATCH"
                ? "The selected run did not match the worker handoff. No job was started."
                : "Manual review submission could not be started.";
          showMessage(message, "error");
          renderManualReviewRun(created.payload.run);
          return created.payload.run || null;
        }
        renderManualReviewRun(created.payload.run);
        startManualPolling();
        return created.payload.run;
      } catch (_error) {
        renderManualReviewRun(null);
        showMessage("Manual review submission could not be started.", "error");
        return null;
      }
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
        await pollManualReviewStatus();
      } catch (_error) {
        showRetryError("The selected Sales Agent run could not be loaded. Please retry.");
      }
    }

    async function init() {
      documentRef.addEventListener("visibilitychange", onVisibilityChange);
      documentRef.addEventListener("keydown", onKeyDown);
      elements.closeDetailsButton?.addEventListener("click", closeDetails);
      elements.runSelector?.addEventListener("change", onRunSelectionChange);
      elements.manualReviewButton?.addEventListener("click", submitManualReviews);
      elements.viewCurrentPartialButton?.addEventListener("click", viewCurrentPartialResults);
      elements.cancelRunButton?.addEventListener("click", cancelCurrentRun);
      elements.platformFilter?.addEventListener("change", () => renderResults(currentResults, { preserveSelection: true }));
      elements.selectCurrentPage?.addEventListener("click", selectAllCurrentPage);
      elements.clearSelection?.addEventListener("click", clearOpportunitySelection);
      elements.previewSelected?.addEventListener("click", () => previewSelection(false));
      elements.holdSelected?.addEventListener("click", () => updateSelectedStatus("HOLD"));
      elements.rejectSelected?.addEventListener("click", () => updateSelectedStatus("REJECTED"));
      elements.editSelected?.addEventListener("click", editSelectedOpportunity);
      elements.submitSelected?.addEventListener("click", submitSelectedOpportunities);
      return refresh();
    }

    return {
      init,
      refresh,
      startRun,
      submitManualReviews,
      renderManualReviewRun,
      pollManualReviewStatus,
      pollStatus,
      renderRun,
      renderResults,
      renderRunHistory,
      loadSelectedRun,
      viewCurrentPartialResults,
      cancelCurrentRun,
      openDetails,
      closeDetails,
      selectAllCurrentPage,
      clearOpportunitySelection,
      selectedReferences,
      previewSelection,
      submitSelectedOpportunities,
      updateSelectedStatus,
      editSelectedOpportunity,
      editOpportunity,
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
