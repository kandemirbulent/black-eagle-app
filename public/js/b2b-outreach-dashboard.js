(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.B2BOutreachDashboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TERMINAL = new Set(["COMPLETED", "FAILED"]);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const value = (item) => item === null || item === undefined || item === "" ? "—" : String(item);
  const idOf = (item) => String(item?._id || item?.id || "");
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const eligibility = (contact = {}) => contact.eligibilityStatus || (!String(contact.decisionMakerName || "").trim() ? "PROSPECT_RESEARCH_REQUIRED" : ["VERIFIED", "VALID"].includes(String(contact.verificationStatus || "").toUpperCase()) && EMAIL_PATTERN.test(String(contact.businessEmail || "").trim()) && String(contact.role || "").trim() ? "SEND_ELIGIBLE" : "CONTACT_REVIEW_REQUIRED");
  const selectable = (contact = {}) => EMAIL_PATTERN.test(String(contact.businessEmail || "").trim().toLowerCase()) && contact.optOut !== true && contact.doNotContact !== true && !["HARD_BOUNCE", "BLOCKED", "INVALID", "INVALID_EMAIL"].includes(String(contact.bounceStatus || "").toUpperCase());
  const eligibilityLabel = (contact) => selectable(contact) ? "Selectable" : ({ PROSPECT_RESEARCH_REQUIRED: "Prospect – Research Required", CONTACT_REVIEW_REQUIRED: "Review Required", CONTACT_VERIFIED: "Verified Contact", SEND_ELIGIBLE: "Send Eligible" })[eligibility(contact)] || "Not Selectable";
  const selectionBlockedReason = (contact = {}) => {
    if (contact.doNotContact === true) return "Not selectable — do not contact.";
    if (contact.optOut === true) return "Not selectable — contact opted out.";
    const bounce = String(contact.bounceStatus || "").toUpperCase();
    if (bounce === "HARD_BOUNCE") return "Not selectable — previous hard bounce.";
    if (["BLOCKED", "INVALID", "INVALID_EMAIL"].includes(bounce)) return "Not selectable — contact is blocked.";
    if (!EMAIL_PATTERN.test(String(contact.businessEmail || "").trim().toLowerCase())) return "Not selectable — business email required.";
    return "Not selectable — contact review required.";
  };
  const sendSafetyWarningReason = (contact = {}) => contact.doNotContact === true ? "Selected — sending blocked: do not contact." : contact.optOut === true ? "Selected — sending blocked: contact opted out." : String(contact.bounceStatus || "").toUpperCase() === "HARD_BOUNCE" ? "Selected — sending blocked: previous hard bounce." : "Selected — sending blocked: contact is suppressed.";
  const researchSelectable = (contact = {}) => ["PROSPECT_RESEARCH_REQUIRED", "EMAIL_RESEARCH_REQUIRED", "REVIEW_REQUIRED", "CONTACT_REVIEW_REQUIRED"].includes(String(contact.researchStatus || contact.eligibilityStatus || contact.outreachStatus || "").toUpperCase());

  function createController({ authFetch, showMessage, actorRole = "ADMIN", documentRef = document, windowRef = typeof window !== "undefined" ? window : { innerWidth: 1280, innerHeight: 800, addEventListener() {} }, sleep = wait, pollIntervalMs = 1500, timeoutMs = 90000, refreshAfterImport, operationOverride }) {
    const el = (id) => documentRef.getElementById(id);
    const state = { page: 1, limit: 25, total: 0, selectedCount: 0, unavailableCount: 0, allResultsSelected: false, contacts: [], selected: new Map(), researchSelected: new Set(), draft: null, draftContact: null, importBatchId: "", importConfirming: false, importResize: null, tooltipControl: null, tooltipPinned: false };
    const isSuperadmin = String(actorRole || "").toUpperCase() === "SUPERADMIN";
    const selectionBlocked = (contact) => isSuperadmin ? !EMAIL_PATTERN.test(String(contact?.businessEmail || "").trim().toLowerCase()) : !selectable(contact);
    const sendSafetyBlocked = (contact) => contact?.optOut === true || contact?.doNotContact === true || ["HARD_BOUNCE", "BLOCKED", "INVALID", "INVALID_EMAIL"].includes(String(contact?.bounceStatus || "").toUpperCase());

    function status(message, type = "success") {
      const target = el("b2bJobStatus");
      if (target) { target.className = `message show ${type}`; target.textContent = message; }
      const importTarget = el("b2bImportStatus");
      if (importTarget && state.importConfirming) { importTarget.className = `message show ${type}`; importTarget.textContent = message; }
    }

    async function json(url, options = {}) {
      const response = await authFetch(url, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw Object.assign(new Error(body.message || "B2B operation failed."), { code: body.code || "B2B_OPERATION_FAILED" });
      return body.data;
    }

    async function waitForRequest(queued) {
      status("Queued...");
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        await sleep(pollIntervalMs);
        const request = await json(`/api/admin/b2b-outreach/requests/${encodeURIComponent(queued.requestId)}`);
        status(request.status === "RUNNING" ? "Processing..." : request.status === "QUEUED" ? "Queued..." : request.status);
        if (!TERMINAL.has(request.status)) continue;
        if (request.status === "FAILED" || request.response?.ok === false) {
          const error = request.response || {};
          throw Object.assign(new Error(error.message || error.code || "B2B operation failed."), { code: error.code || "B2B_OPERATION_FAILED" });
        }
        status("Completed");
        return request.response?.data;
      }
      status("Timed out while waiting for the Sales Agent.", "error");
      throw Object.assign(new Error("B2B operation timed out."), { code: "B2B_REQUEST_TIMEOUT" });
    }

    async function operation(operationName, payload = {}) {
      if (operationOverride) return operationOverride(operationName, payload);
      status("Creating request...");
      const queued = await json("/api/admin/b2b-outreach/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: operationName, payload }) });
      return waitForRequest(queued);
    }

    function filters() {
      const payload = { page: state.page, limit: state.limit };
      for (const [field, elementId] of [["search", "b2bSearch"], ["segment", "b2bSegment"], ["outreachStatus", "b2bStatus"], ["eligibilityStatus", "b2bEligibility"]]) if (el(elementId)?.value.trim()) payload[field] = el(elementId).value.trim();
      for (const [field, elementId] of [["hasEmail", "b2bHasEmail"], ["namedContact", "b2bNamedContact"], ["replied", "b2bReplied"]]) if (el(elementId)?.value) payload[field] = el(elementId).value === "true";
      return payload;
    }

    function updateSelection() {
      el("b2bSelectedCount").textContent = `${state.selectedCount} contacts selected${state.unavailableCount ? ` · ${state.unavailableCount} unavailable` : ""}`;
      el("b2bGenerateSelected").disabled = state.selectedCount === 0;
      const eligible = state.contacts.filter((contact) => !selectionBlocked(contact));
      const selectedOnPage = eligible.filter((contact) => Boolean(contact.selectedAt)).length;
      const pageCheckbox = el("b2bSelectPage");
      pageCheckbox.checked = eligible.length > 0 && selectedOnPage === eligible.length;
      pageCheckbox.indeterminate = selectedOnPage > 0 && selectedOnPage < eligible.length;
      pageCheckbox.disabled = eligible.length === 0;
      el("b2bSelectAllResults").textContent = state.allResultsSelected ? "Deselect All Results" : "Select All Results";
      const researchButton = el("b2bResearchSelected"); if (researchButton) { researchButton.disabled = state.researchSelected.size === 0; researchButton.textContent = `Research Selected${state.researchSelected.size ? ` (${state.researchSelected.size})` : ""}`; }
    }

    function showEligibilityTooltip(control, pinned = false) {
      const tooltip = el("b2bEligibilityTooltip"), reason = control?.dataset?.tooltip;
      if (!tooltip || !reason) return;
      state.tooltipControl = control; state.tooltipPinned = pinned;
      tooltip.textContent = reason; tooltip.classList.remove("hidden");
      control.setAttribute("aria-expanded", "true");
      const anchor = control.getBoundingClientRect(), box = tooltip.getBoundingClientRect(), margin = 12;
      const left = Math.min(windowRef.innerWidth - box.width - margin, Math.max(margin, anchor.left + anchor.width / 2 - box.width / 2));
      const below = anchor.bottom + 8, top = below + box.height <= windowRef.innerHeight - margin ? below : Math.max(margin, anchor.top - box.height - 8);
      tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`;
    }
    function hideEligibilityTooltip(force = false) {
      if (state.tooltipPinned && !force) return;
      const tooltip = el("b2bEligibilityTooltip"); if (tooltip) tooltip.classList.add("hidden");
      state.tooltipControl?.setAttribute?.("aria-expanded", "false"); state.tooltipControl = null; state.tooltipPinned = false;
    }
    function toggleEligibilityTooltip(control) { if (state.tooltipPinned && state.tooltipControl === control) hideEligibilityTooltip(true); else showEligibilityTooltip(control, true); }
    function handleEligibilityOutsideClick(event) { if (!event.target.closest?.(".b2b-eligibility-info")) hideEligibilityTooltip(true); }
    function handleEligibilityKeydown(event) { if (event.key === "Escape") hideEligibilityTooltip(true); }

    function renderContacts() {
      const tbody = el("b2bContactsTable");
      tbody.replaceChildren();
      if (!state.contacts.length) { const row = tbody.insertRow(); const cell = row.insertCell(); cell.colSpan = 13; cell.textContent = "No B2B contacts available."; return; }
      for (const contact of state.contacts) {
        const row = tbody.insertRow();
        const suppressed = selectionBlocked(contact), warning = suppressed || (isSuperadmin && sendSafetyBlocked(contact));
        const checkbox = documentRef.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = Boolean(contact.selectedAt); checkbox.disabled = suppressed;
        checkbox.addEventListener("change", () => toggleContact(contact, checkbox.checked).catch(handleError));
        const checkboxWrap = documentRef.createElement("span"); checkboxWrap.appendChild(checkbox); if (warning) { const reason = isSuperadmin && !suppressed ? sendSafetyWarningReason(contact) : selectionBlockedReason(contact), info = documentRef.createElement("button"); info.type = "button"; info.className = "b2b-eligibility-info"; info.textContent = "i"; info.dataset.tooltip = reason; info.setAttribute("aria-label", reason); info.setAttribute("aria-describedby", "b2bEligibilityTooltip"); info.setAttribute("aria-expanded", "false"); info.addEventListener("mouseenter", () => showEligibilityTooltip(info)); info.addEventListener("mouseleave", () => hideEligibilityTooltip()); info.addEventListener("focus", () => showEligibilityTooltip(info)); info.addEventListener("blur", () => hideEligibilityTooltip()); info.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); toggleEligibilityTooltip(info); }); checkboxWrap.appendChild(info); } row.insertCell().appendChild(checkboxWrap);
        if (isSuperadmin && researchSelectable(contact)) { const research = documentRef.createElement("input"); research.type = "checkbox"; research.className = "b2b-research-checkbox"; research.checked = state.researchSelected.has(idOf(contact)); research.setAttribute("aria-label", `Select ${value(contact.companyName)} for research`); research.addEventListener("change", () => toggleResearchContact(contact, research.checked)); checkboxWrap.appendChild(research); const marker = documentRef.createElement("span"); marker.className = "subtle"; marker.textContent = "Research"; checkboxWrap.appendChild(marker); }
        const fields = [contact.decisionMakerName, contact.companyName, contact.role, contact.businessEmail || "EMAIL RESEARCH REQUIRED", contact.segment, contact.bestBlackEagleOffer, contact.verificationStatus, eligibilityLabel(contact), suppressed ? [contact.optOut && "OPT OUT", contact.doNotContact && "DO NOT CONTACT", contact.bounceStatus].filter(Boolean).join(" / ") || contact.outreachStatus : contact.outreachStatus, contact.lastEmailSentAt ? new Date(contact.lastEmailSentAt).toLocaleString() : "Never", contact.replied ? `Replied ${contact.repliedAt ? new Date(contact.repliedAt).toLocaleString() : ""}` : "Not replied"];
        for (const field of fields) row.insertCell().textContent = value(field);
        const action = documentRef.createElement("button"); action.type = "button"; action.className = "btn btn-secondary"; action.textContent = "Generate Draft"; action.disabled = !contact.selectedAt || selectionBlocked(contact); action.addEventListener("click", () => generate(contact).catch(handleError)); row.insertCell().appendChild(action);
      }
      const pages = Math.max(1, Math.ceil(state.total / state.limit)); el("b2bPageSummary").textContent = `Page ${state.page} of ${pages} · ${state.total} contacts`; el("b2bPreviousPage").disabled = state.page <= 1; el("b2bNextPage").disabled = state.page >= pages;
      updateSelection();
    }

    async function loadContacts() {
      const data = await operation("LIST_CONTACTS", filters());
      state.contacts = Array.isArray(data?.items) ? data.items : []; state.total = Number(data?.total || 0); state.selectedCount = Number(data?.selectedCount || 0); state.allResultsSelected = Number(data?.eligibleCount || 0) > 0 && Number(data?.selectedEligibleCount || 0) === Number(data?.eligibleCount || 0);
      state.selected.clear(); for (const contact of state.contacts) if (contact.selectedAt) state.selected.set(idOf(contact), contact);
      renderContacts();
    }

    async function toggleContact(contact, selected, reload = true) {
      await operation(selected ? "SELECT_CONTACT" : "DESELECT_CONTACT", selected ? { contactId: idOf(contact), expectedVersion: Number(contact.recordVersion) } : { contactId: idOf(contact) });
      if (selected) state.selected.set(idOf(contact), contact); else state.selected.delete(idOf(contact));
      if (reload) await loadContacts();
      const companies = [...state.selected.values()].map((item) => String(item.normalizedCompany || item.companyName || "").toLowerCase()).filter(Boolean);
      if (new Set(companies).size < companies.length) showMessage("Multiple contacts from the same company are selected. Sales Agent company cooldown remains authoritative.", "error");
    }

    async function selectCurrentPage(selected) {
      const candidates = state.contacts.filter((contact) => !selectionBlocked(contact) && Boolean(contact.selectedAt) !== selected);
      el("b2bSelectPage").disabled = true;
      for (const contact of candidates) await toggleContact(contact, selected, false);
      state.unavailableCount = state.contacts.filter(selectionBlocked).length;
      await loadContacts();
    }

    async function selectAllResults() {
      const result = await operation("BULK_SELECT_CONTACTS", filters());
      state.unavailableCount = Number(result?.unavailable || 0);
      await loadContacts();
      status(result?.action === "DESELECTED" ? `${result?.eligibleCount || 0} filtered contacts deselected.` : `${result?.selected || 0} eligible contacts selected${state.unavailableCount ? ` · ${state.unavailableCount} unavailable` : ""}.`);
    }

    async function clearSelection() {
      await operation("CLEAR_CONTACT_SELECTION");
      state.unavailableCount = 0;
      await loadContacts();
      status("Contact selection cleared.");
    }

    function toggleResearchContact(contact, selected) {
      if (!isSuperadmin || !researchSelectable(contact)) return false;
      if (selected) state.researchSelected.add(idOf(contact)); else state.researchSelected.delete(idOf(contact));
      updateSelection(); return true;
    }

    async function researchSelected() {
      const contactIds = [...state.researchSelected];
      if (!contactIds.length) throw new Error("Select research-required prospects first.");
      const result = await operation("RESEARCH_BATCH", { contactIds });
      state.researchSelected.clear(); status(`Completed · ${result?.completed || 0} enriched · ${result?.researchRequired || 0} research required · ${result?.failed || 0} failed`);
      await loadContacts();
    }

    async function researchCurrentResults() {
      const result = await operation("RESEARCH_BATCH", filters());
      status(`Completed · ${result?.completed || 0} enriched · ${result?.researchRequired || 0} research required · ${result?.failed || 0} failed`);
      await loadContacts();
    }

    async function generate(contact) {
      if (selectionBlocked(contact)) throw new Error("A valid business email is required to generate a draft.");
      const drafts = await operation("GENERATE_DRAFT", { contactId: idOf(contact) });
      const generated = Array.isArray(drafts) ? drafts[0] : drafts;
      await openDraft(generated?._id || generated?.id, contact);
    }

    async function generateSelected() { for (const contact of [...state.selected.values()]) await generate(contact); }

    async function openDraft(draftId, contact) {
      if (!draftId) throw new Error("Draft ID was not returned.");
      const draft = await operation("GET_DRAFT", { draftId: String(draftId) });
      state.draft = draft; state.draftContact = contact;
      el("b2bDraftPanel").classList.remove("hidden"); el("b2bDraftTo").textContent = value(contact.businessEmail); el("b2bDraftContact").textContent = [contact.decisionMakerName, contact.companyName, contact.role].filter(Boolean).join(" · "); el("b2bDraftStatus").textContent = `${value(draft.status)} · ${draft.approved ? "Approved" : "Not approved"}`; el("b2bDraftReview").textContent = value([...(draft.reviewCodes || []), ...(contact.deliverabilityBlockers || [])].join(", "));
      el("b2bDraftSubject").value = draft.subject || ""; el("b2bDraftBody").value = draft.body || ""; el("b2bVerifiedContext").textContent = `Verified Context: ${value(JSON.stringify(draft.contextSnapshot || {}))}`;
      el("b2bApproveDraft").disabled = draft.approved || String(draft.status).startsWith("BLOCKED_"); el("b2bSendApproved").disabled = !draft.approved;
      el("b2bDraftPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function saveDraft() { const draft = await operation("UPDATE_DRAFT", { draftId: idOf(state.draft), subject: el("b2bDraftSubject").value, body: el("b2bDraftBody").value }); state.draft = draft; await openDraft(idOf(draft), state.draftContact); }
    async function approveDraft() { await operation("APPROVE_DRAFT", { draftId: idOf(state.draft) }); await openDraft(idOf(state.draft), state.draftContact); }
    async function sendApproved() { try { await operation("SEND_APPROVED", { draftId: idOf(state.draft) }); } catch (error) { if (error.code === "B2B_OUTREACH_SEND_DISABLED") { status("Email sending is not enabled yet.", "error"); return; } throw error; } }
    function importModalSize(width, height) {
      const panel = el("b2bImportPanel");
      if (!panel || windowRef.innerWidth <= 700) { if (panel) { panel.style.width = ""; panel.style.height = ""; } return null; }
      const maxWidth = Math.max(0, windowRef.innerWidth - 32), maxHeight = Math.max(0, windowRef.innerHeight - 32);
      const next = { width: Math.min(maxWidth, Math.max(Math.min(700, maxWidth), width)), height: Math.min(maxHeight, Math.max(Math.min(450, maxHeight), height)) };
      panel.style.width = `${next.width}px`; panel.style.height = `${next.height}px`; return next;
    }
    function resetImportModalSize() { return importModalSize(windowRef.innerWidth * 0.92, windowRef.innerHeight * 0.86); }
    function startImportResize(event) { if (windowRef.innerWidth <= 700) return; const panel = el("b2bImportPanel"), rect = panel.getBoundingClientRect(); state.importResize = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height }; el("b2bImportResizeHandle")?.setPointerCapture?.(event.pointerId); event.preventDefault?.(); event.stopPropagation?.(); }
    function moveImportResize(event) { if (!state.importResize || event.pointerId !== state.importResize.pointerId) return; importModalSize(state.importResize.width + event.clientX - state.importResize.startX, state.importResize.height + event.clientY - state.importResize.startY); }
    function stopImportResize(event) { if (!state.importResize || event.pointerId !== state.importResize.pointerId) return; el("b2bImportResizeHandle")?.releasePointerCapture?.(event.pointerId); state.importResize = null; event.stopPropagation?.(); }
    function clampImportModal() { const panel = el("b2bImportPanel"); if (!panel) return; const rect = panel.getBoundingClientRect(); importModalSize(rect.width, rect.height); }
    function openImport() { state.importBatchId = ""; state.importConfirming = false; el("b2bImportFile").value = ""; el("b2bConfirmImport").disabled = true; const target = el("b2bImportStatus"); if (target) { target.className = "message"; target.textContent = ""; } el("b2bImportModal").classList.remove("hidden"); resetImportModalSize(); }
    function closeImport() { el("b2bImportModal").classList.add("hidden"); }
    function renderImportPreview(data) {
      state.importBatchId = data.batchId;
      el("b2bImportSheetInfo").textContent = `Selected sheet: ${value(data.selectedSheet)} · Workbook sheets: ${(data.sheetNames || []).join(", ")}`;
      const summary = data.summary || {}; el("b2bImportSummary").replaceChildren();
      for (const [label, count] of [["Total rows", summary.totalRows], ["Prospect Research Required", summary.prospectResearchRequired], ["Contact Review Required", summary.contactReviewRequired], ["Verified Contact", summary.contactVerified], ["Send Eligible", summary.sendEligible], ["Duplicates", summary.duplicates], ["Invalid", summary.invalid], ["Importable (not mail-ready)", summary.importable]]) { const card = documentRef.createElement("div"); card.className = "stat-card"; const title = documentRef.createElement("span"); title.textContent = label; const strong = documentRef.createElement("strong"); strong.textContent = String(count || 0); card.append(title, strong); el("b2bImportSummary").appendChild(card); }
      const tbody = el("b2bImportPreview"); tbody.replaceChildren(); const visible = (data.rows || []).slice(0, 200);
      for (const row of visible) { const tr = tbody.insertRow(); for (const item of [row.row, row.contact?.companyName, row.contact?.decisionMakerName, row.contact?.role, row.contact?.businessEmail || "EMAIL RESEARCH REQUIRED", row.contact?.segment, row.contact?.verificationStatus, eligibilityLabel(row.contact), row.importStatus, (row.reasons || []).join(", ")]) tr.insertCell().textContent = value(item); }
      el("b2bImportPreviewLimit").textContent = (data.rows || []).length > visible.length ? `Showing first ${visible.length} of ${data.rows.length} rows.` : "";
      el("b2bConfirmImport").disabled = !state.importBatchId || Number(summary.importable || 0) === 0;
    }
    async function previewImport() { const file = el("b2bImportFile").files?.[0]; if (!file) return; const body = new FormData(); body.append("file", file); status("Parsing import file..."); const data = await json("/api/admin/b2b-outreach/import/preview", { method: "POST", body }); renderImportPreview(data); status("Preview ready. No contacts have been imported."); }
    async function confirmImport() {
      if (state.importConfirming) return;
      const batchId = state.importBatchId;
      if (!batchId) { state.importConfirming = true; status("Import failed: Import preview was not found. Preview the file again.", "error"); state.importConfirming = false; return; }
      state.importConfirming = true;
      const button = el("b2bConfirmImport"); button.disabled = true; button.textContent = "Importing...";
      let completed = false;
      try {
        status("Confirming import...");
        const result = await json("/api/admin/b2b-outreach/import/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) });
        const imported = result.completed ? result.result : await waitForRequest(result);
        status("Completed");
        const summary = `Imported: ${imported?.imported || 0} · Skipped duplicates: ${imported?.skippedDuplicates || 0} · Review required: ${imported?.reviewRequired || 0} · Invalid: ${imported?.invalid || 0}`;
        status(summary);
        state.importBatchId = "";
        completed = true;
        state.importConfirming = false;
        await (refreshAfterImport ? refreshAfterImport() : loadContacts());
        await sleep(1000);
        closeImport();
        status("Import completed successfully.");
      } catch (error) {
        const safeMessage = error?.message || "B2B operation failed.";
        status(`Import failed: ${safeMessage}`, "error");
      } finally {
        state.importConfirming = false;
        button.textContent = "Confirm Import";
        button.disabled = completed || !state.importBatchId;
      }
    }
    function handleError(error) { const message = error?.code === "B2B_OUTREACH_SEND_DISABLED" ? "Email sending is not enabled yet." : error?.message || "B2B operation failed."; status(message, "error"); showMessage(message, "error"); }

    async function init() {
      if (isSuperadmin) el("b2bSelectionHelp").textContent = "Outreach selection requires a business email. Research-required prospects can be selected separately for research. Sending safety checks are applied before email delivery.";
      const researchSelectedButton = el("b2bResearchSelected"), researchResultsButton = el("b2bResearchResults");
      if (researchSelectedButton) { researchSelectedButton.hidden = !isSuperadmin; researchSelectedButton.addEventListener("click", () => researchSelected().catch(handleError)); }
      if (researchResultsButton) { researchResultsButton.hidden = !isSuperadmin; researchResultsButton.addEventListener("click", () => researchCurrentResults().catch(handleError)); }
      el("b2bApplyFilters").addEventListener("click", () => { state.page = 1; state.unavailableCount = 0; loadContacts().catch(handleError); }); el("b2bGenerateSelected").addEventListener("click", () => generateSelected().catch(handleError)); el("b2bSelectPage").addEventListener("change", (event) => selectCurrentPage(event.target.checked).catch(handleError)); el("b2bSelectAllResults").addEventListener("click", () => selectAllResults().catch(handleError)); el("b2bClearSelection").addEventListener("click", () => clearSelection().catch(handleError)); el("b2bPreviousPage").addEventListener("click", () => { if (state.page > 1) { state.page--; loadContacts().catch(handleError); } }); el("b2bNextPage").addEventListener("click", () => { state.page++; loadContacts().catch(handleError); }); el("b2bSaveDraft").addEventListener("click", () => saveDraft().catch(handleError)); el("b2bApproveDraft").addEventListener("click", () => approveDraft().catch(handleError)); el("b2bSendApproved").addEventListener("click", () => sendApproved().catch(handleError));
      el("b2bImportExcel").addEventListener("click", openImport); el("b2bImportClose").addEventListener("click", closeImport); el("b2bImportFile").addEventListener("change", () => previewImport().catch(handleError)); el("b2bConfirmImport").addEventListener("click", confirmImport); el("b2bImportModal").addEventListener("click", (event) => { if (event.target === el("b2bImportModal")) closeImport(); });
      const resizeHandle = el("b2bImportResizeHandle"); resizeHandle.addEventListener("pointerdown", startImportResize); resizeHandle.addEventListener("pointermove", moveImportResize); resizeHandle.addEventListener("pointerup", stopImportResize); resizeHandle.addEventListener("pointercancel", stopImportResize); windowRef.addEventListener("pointermove", moveImportResize); windowRef.addEventListener("pointerup", stopImportResize); windowRef.addEventListener("pointercancel", stopImportResize); windowRef.addEventListener("resize", clampImportModal);
      documentRef.addEventListener("click", handleEligibilityOutsideClick); documentRef.addEventListener("keydown", handleEligibilityKeydown);
      let loaded = false;
      el("b2bOutreachNavButton")?.addEventListener("click", () => { if (!loaded) { loaded = true; loadContacts().catch((error) => { loaded = false; handleError(error); }); } });
      return null;
    }
    return { init, operation, loadContacts, toggleContact, toggleResearchContact, selectCurrentPage, selectAllResults, clearSelection, researchSelected, researchCurrentResults, generate, saveDraft, approveDraft, sendApproved, previewImport, confirmImport, renderImportPreview, importModalSize, resetImportModalSize, startImportResize, moveImportResize, stopImportResize, clampImportModal, showEligibilityTooltip, hideEligibilityTooltip, toggleEligibilityTooltip, handleEligibilityOutsideClick, handleEligibilityKeydown, isContactSelectionBlocked: selectionBlocked, state };
  }
  return { createController, selectionBlockedReason, researchSelectable };
});
