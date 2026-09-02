const express = require("express");
const { Types: { ObjectId } } = require("mongoose");
const { B2B_OUTREACH_WORKER_COMMAND, createRenderSalesAgentTrigger, RenderTriggerError } = require("../services/salesAgentJobTrigger");
const { buildSignedRequest, safeResponse } = require("../services/b2bOutreachIntegration");

function createB2BOutreachRouter({ requireAdminAuth, getRequestsCollection, triggerJob = createRenderSalesAgentTrigger(), env = process.env, now = () => new Date(), logger = console }) {
  const router = express.Router();

  router.post("/admin/b2b-outreach/operations", requireAdminAuth, async (req, res) => {
    let insertedId;
    try {
      const document = buildSignedRequest({
        operation: String(req.body?.operation || "").toUpperCase(),
        payload: req.body?.payload || {},
        actorId: req.adminUser?._id,
        secret: env.B2B_OUTREACH_INTERNAL_API_KEY,
        now,
      });
      const collection = getRequestsCollection();
      const inserted = await collection.insertOne(document);
      insertedId = inserted.insertedId;
      const job = await triggerJob({ startCommand: B2B_OUTREACH_WORKER_COMMAND, b2bRequestId: String(insertedId) });
      await collection.updateOne({ _id: insertedId, status: "QUEUED" }, { $set: { renderJobId: job.jobId, updatedAt: now() } });
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

  router.get("/admin/b2b-outreach/requests/:id", requireAdminAuth, async (req, res) => {
    if (!ObjectId.isValid(String(req.params.id))) return res.status(400).json({ ok: false, code: "B2B_REQUEST_ID_INVALID", message: "Invalid request ID." });
    const document = await getRequestsCollection().findOne({ _id: new ObjectId(String(req.params.id)), actorId: String(req.adminUser._id) });
    if (!document) return res.status(404).json({ ok: false, code: "B2B_REQUEST_NOT_FOUND", message: "B2B request was not found." });
    return res.json({ ok: true, data: safeResponse(document) });
  });

  return router;
}

module.exports = { createB2BOutreachRouter };
