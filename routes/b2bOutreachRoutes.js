const express = require("express");
const path = require("node:path");
const multer = require("multer");
const { Types: { ObjectId } } = require("mongoose");
const { B2B_OUTREACH_WORKER_COMMAND, createRenderSalesAgentTrigger, RenderTriggerError } = require("../services/salesAgentJobTrigger");
const { buildSignedRequest, safeResponse } = require("../services/b2bOutreachIntegration");
const { parseWorkbook, applyDuplicateStatus, summarize, createPreviewBatchStore } = require("../services/b2bProspectImport");

function createB2BOutreachRouter({ requireAdminAuth, getRequestsCollection, getContactsCollection, triggerJob = createRenderSalesAgentTrigger(), env = process.env, now = () => new Date(), logger = console, batchStore = createPreviewBatchStore({ now }) }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter(_req, file, done) { const extension = path.extname(file.originalname || "").toLowerCase(); done(extension && [".xlsx", ".xls", ".csv"].includes(extension) ? null : Object.assign(new Error("Only .xlsx, .xls and .csv files are supported."), { code: "B2B_IMPORT_FILE_TYPE_INVALID" }), Boolean(extension && [".xlsx", ".xls", ".csv"].includes(extension))); } });

  async function enqueue(operation, payload, actorId) {
    const document = buildSignedRequest({ operation, payload, actorId, secret: env.B2B_OUTREACH_INTERNAL_API_KEY, now });
    const collection = getRequestsCollection();
    const inserted = await collection.insertOne(document);
    const job = await triggerJob({ startCommand: B2B_OUTREACH_WORKER_COMMAND, b2bRequestId: String(inserted.insertedId) });
    await collection.updateOne({ _id: inserted.insertedId, status: "QUEUED" }, { $set: { renderJobId: job.jobId, updatedAt: now() } });
    return inserted.insertedId;
  }

  router.post("/admin/b2b-outreach/operations", requireAdminAuth, async (req, res) => {
    let insertedId;
    try {
      insertedId = await enqueue(String(req.body?.operation || "").toUpperCase(), req.body?.payload || {}, req.adminUser?._id);
      return res.status(202).json({ ok: true, data: { requestId: String(insertedId), status: "QUEUED" } });
    } catch (error) {
      const code = error?.code || "B2B_REQUEST_CREATE_FAILED";
      if (insertedId) {
        await getRequestsCollection().updateOne({ _id: insertedId, status: "QUEUED" }, { $set: {
          status: "FAILED", response: { ok: false, code, message: error instanceof RenderTriggerError ? "B2B worker could not be started." : "B2B request failed." }, completedAt: now(), updatedAt: now(),
        } }).catch(() => {});
      }
      logger.error?.(`B2B_OUTREACH_REQUEST_FAILED code=${code} requestId=${insertedId || "not-created"}`);
      const status = ["B2B_AUTH_NOT_CONFIGURED"].includes(code) ? 503 : code === "B2B_OPERATION_NOT_SUPPORTED" ? 400 : 502;
      const safeMessage = code === "B2B_AUTH_NOT_CONFIGURED" ? "B2B integration is not configured."
        : code === "B2B_OPERATION_NOT_SUPPORTED" ? "Unsupported B2B operation."
          : error instanceof RenderTriggerError ? "B2B worker could not be started." : "B2B request failed.";
      return res.status(status).json({ ok: false, code, message: safeMessage });
    }
  });

  router.post("/admin/b2b-outreach/import/preview", requireAdminAuth, (req, res) => {
    upload.single("file")(req, res, async (uploadError) => {
      try {
        if (uploadError) throw uploadError;
        if (!req.file?.buffer) return res.status(400).json({ ok: false, code: "B2B_IMPORT_FILE_REQUIRED", message: "Select an Excel or CSV file." });
        const parsed = parseWorkbook(req.file.buffer, path.basename(req.file.originalname));
        await applyDuplicateStatus(parsed, getContactsCollection());
        const batchId = batchStore.create(req.adminUser._id, parsed);
        return res.json({ ok: true, data: { batchId, sourceFileName: parsed.sourceFileName, sheetNames: parsed.sheetNames, selectedSheet: parsed.selectedSheet, rows: parsed.rows, summary: summarize(parsed.rows) } });
      } catch (error) {
        const tooLarge = error?.code === "LIMIT_FILE_SIZE";
        return res.status(400).json({ ok: false, code: tooLarge ? "B2B_IMPORT_FILE_TOO_LARGE" : error?.code || "B2B_IMPORT_PARSE_FAILED", message: tooLarge ? "File exceeds the 10 MB limit." : error?.message || "File could not be parsed." });
      }
    });
  });

  router.post("/admin/b2b-outreach/import/confirm", requireAdminAuth, async (req, res) => {
    let insertedId;
    try {
      const parsed = batchStore.consume(req.body?.batchId, req.adminUser._id);
      if (!parsed) return res.status(404).json({ ok: false, code: "B2B_IMPORT_BATCH_NOT_FOUND", message: "Import preview expired or was not found." });
      await applyDuplicateStatus(parsed, getContactsCollection());
      const confirmedSummary = summarize(parsed.rows);
      const contacts = parsed.rows.filter((row) => row.importable).map((row) => row.contact);
      if (!contacts.length) return res.json({ ok: true, data: { completed: true, result: { imported: 0, skippedDuplicates: parsed.rows.filter((row) => row.importStatus === "DUPLICATE").length, reviewRequired: 0, invalid: parsed.rows.filter((row) => !row.importable && row.importStatus !== "DUPLICATE").length } } });
      insertedId = await enqueue("IMPORT_CONTACTS", { contacts, importMeta: { sourceFileName: parsed.sourceFileName, importBatchId: String(req.body.batchId), previewSkippedDuplicates: confirmedSummary.duplicates, previewInvalid: confirmedSummary.invalid + parsed.rows.filter((row) => row.importStatus === "REVIEW_REQUIRED" && !row.importable).length } }, req.adminUser._id);
      return res.status(202).json({ ok: true, data: { requestId: String(insertedId), status: "QUEUED" } });
    } catch (error) {
      const code = error?.code || "B2B_IMPORT_CONFIRM_FAILED";
      logger.error?.(`B2B_IMPORT_CONFIRM_FAILED code=${code} requestId=${insertedId || "not-created"}`);
      return res.status(code === "B2B_AUTH_NOT_CONFIGURED" ? 503 : 502).json({ ok: false, code, message: "B2B import could not be started." });
    }
  });

  router.get("/admin/b2b-outreach/requests/:id", requireAdminAuth, async (req, res) => {
    if (!ObjectId.isValid(String(req.params.id))) return res.status(400).json({ ok: false, code: "B2B_REQUEST_ID_INVALID", message: "Invalid request ID." });
    const document = await getRequestsCollection().findOne({ _id: new ObjectId(String(req.params.id)), actorId: String(req.adminUser._id) });
    if (!document) return res.status(404).json({ ok: false, code: "B2B_REQUEST_NOT_FOUND", message: "B2B request was not found." });
    return res.json({ ok: true, data: safeResponse(document) });
  });

  return router;
}

module.exports = { createB2BOutreachRouter };
