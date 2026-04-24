const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const Event = require("../models/event");
const Staff = require("../models/staff");
const EventApplication = require("../models/eventApplication");
const EventAssignment = require("../models/eventAssignment");
const { normalizeRole } = require("../utils/event-utils");

function getStaffId(req) {
  const fromBody = req.body?.staffId;
  const fromQuery = req.query?.staffId;
  const fromHeader = req.headers["x-staff-id"];

  return fromBody || fromQuery || fromHeader || null;
}

function getStaffRoles(staff) {
  if (!Array.isArray(staff.positions)) return [];
  return staff.positions.map(normalizeRole).filter(Boolean);
}

// GET /api/staff-events/available-events
router.get("/available-events", async (req, res) => {
  try {
    const staffId = getStaffId(req);

    if (!staffId || !mongoose.Types.ObjectId.isValid(staffId)) {
      return res.status(401).json({
        success: false,
        message: "Valid staff ID is required",
      });
    }

    const staff = await Staff.findById(staffId).lean();

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (staff.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Only active staff can view available events",
      });
    }

    const staffRoles = getStaffRoles(staff);

    if (!staffRoles.length) {
      return res.status(400).json({
        success: false,
        message: "No staff positions defined",
      });
    }

    const now = new Date();

    const events = await Event.find({
      status: "open",
      eventDate: { $gte: now },
      roleRequirements: {
        $elemMatch: {
          role: { $in: staffRoles },
        },
      },
    })
      .sort({ eventDate: 1, startTime: 1, createdAt: -1 })
      .lean();

    if (!events.length) {
      return res.json({
        success: true,
        events: [],
      });
    }

    const eventIds = events.map((event) => event._id);

    const [applications, assignments] = await Promise.all([
      EventApplication.find({
        event: { $in: eventIds },
        staff: staffId,
        status: { $in: ["pending", "approved"] },
      }).lean(),

      EventAssignment.find({
        event: { $in: eventIds },
        status: { $in: ["assigned", "confirmed", "completed"] },
      }).lean(),
    ]);

    const appliedSet = new Set(applications.map((item) => String(item.event)));

    const assignmentMap = new Map();
    // eventId => { byRole: { waiter: 2 }, staffIds: Set([...]) }

    for (const item of assignments) {
      const eventKey = String(item.event);
      const roleKey = normalizeRole(item.role);
      const assignedStaffId = String(item.staff);

      if (!assignmentMap.has(eventKey)) {
        assignmentMap.set(eventKey, {
          byRole: {},
          staffIds: new Set(),
        });
      }

      const bucket = assignmentMap.get(eventKey);
      bucket.byRole[roleKey] = (bucket.byRole[roleKey] || 0) + 1;
      bucket.staffIds.add(assignedStaffId);
    }

    const availableEvents = [];

    for (const event of events) {
      const eventKey = String(event._id);

      // Daha önce başvurduğu işi görmesin
      if (appliedSet.has(eventKey)) {
        continue;
      }

      const assignmentInfo = assignmentMap.get(eventKey) || {
        byRole: {},
        staffIds: new Set(),
      };

      // Zaten atandığı işi görmesin
      if (assignmentInfo.staffIds.has(String(staffId))) {
        continue;
      }

      const eligibleRoles = (event.roleRequirements || [])
        .map((item) => {
          const role = normalizeRole(item.role);
          const quantityRequired = Number(item.quantityRequired || 0);
          const assignedCount = Number(assignmentInfo.byRole[role] || 0);
          const remainingCount = Math.max(quantityRequired - assignedCount, 0);

          return {
            role,
            quantityRequired,
            assignedCount,
            remainingCount,
          };
        })
        .filter(
          (item) =>
            staffRoles.includes(item.role) && item.remainingCount > 0
        );

      // Bu staff için açık kontenjan yoksa event görünmesin
      if (!eligibleRoles.length) {
        continue;
      }

      availableEvents.push({
        ...event,
        eligibleRoles,
      });
    }

    return res.json({
      success: true,
      events: availableEvents,
    });
  } catch (err) {
    console.error("GET /available-events error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// POST /api/staff-events/apply/:eventId
router.post("/apply/:eventId", async (req, res) => {
  try {
    const staffId = getStaffId(req);
    const { eventId } = req.params;
    const selectedRole = normalizeRole(req.body?.role);

    if (!staffId || !mongoose.Types.ObjectId.isValid(staffId)) {
      return res.status(401).json({
        success: false,
        message: "Valid staff ID is required",
      });
    }

    if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Valid event ID is required",
      });
    }

    if (!selectedRole) {
      return res.status(400).json({
        success: false,
        message: "Role is required",
      });
    }

    const staff = await Staff.findById(staffId).lean();

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (staff.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Only active staff can apply",
      });
    }

    const staffRoles = getStaffRoles(staff);

    if (!staffRoles.includes(selectedRole)) {
      return res.status(400).json({
        success: false,
        message: "You are not eligible for this role",
      });
    }

    const event = await Event.findById(eventId).lean();

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (event.status !== "open") {
      return res.status(400).json({
        success: false,
        message: "This event is not open",
      });
    }

    if (!event.eventDate || new Date(event.eventDate) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Past events cannot be applied",
      });
    }

    const requiredRole = (event.roleRequirements || []).find(
      (item) => normalizeRole(item.role) === selectedRole
    );

    if (!requiredRole) {
      return res.status(400).json({
        success: false,
        message: "This role is not available for the event",
      });
    }

    const existingApplication = await EventApplication.findOne({
      event: eventId,
      staff: staffId,
      status: { $in: ["pending", "approved"] },
    }).lean();

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: "You already applied to this event",
      });
    }

    const existingAssignment = await EventAssignment.findOne({
      event: eventId,
      staff: staffId,
      status: { $in: ["assigned", "confirmed", "completed"] },
    }).lean();

    if (existingAssignment) {
      return res.status(400).json({
        success: false,
        message: "You are already assigned to this event",
      });
    }

    const assignedCount = await EventAssignment.countDocuments({
      event: eventId,
      role: selectedRole,
      status: { $in: ["assigned", "confirmed", "completed"] },
    });

    if (assignedCount >= Number(requiredRole.quantityRequired || 0)) {
      return res.status(400).json({
        success: false,
        message: "This role is already full",
      });
    }

    await EventApplication.create({
      event: eventId,
      staff: staffId,
      role: selectedRole,
      status: "pending",
    });

    return res.json({
      success: true,
      message: "Application submitted successfully",
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "You already applied to this event",
      });
    }

    console.error("POST /apply/:eventId error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});
// 🔥 BURAYA EKLE (my-applications route)
router.get("/my-applications", async (req, res) => {
  try {
    const staffId = getStaffId(req);

    if (!staffId) {
      return res.status(400).json({ success: false });
    }

    const applications = await EventApplication.find({ staff: staffId })
      .populate("event")
      .lean();

    return res.json({
      success: true,
      applications,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});



module.exports = router;
