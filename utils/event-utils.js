function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function buildRoleRequirementsFromOrder(order = {}) {
  const staffRows = Array.isArray(order.staff) ? order.staff : [];
  const roleMap = new Map();

  for (const row of staffRows) {
    const role = normalizeRole(row.service);
    const qty = Number(row.quantity || 0);

    if (!role || qty <= 0) continue;

    roleMap.set(role, (roleMap.get(role) || 0) + qty);
  }

  return Array.from(roleMap.entries()).map(([role, quantityRequired]) => ({
    role,
    quantityRequired,
  }));
}

function getRequiredQuantityForRole(event = {}, role) {
  const requirements = Array.isArray(event.roleRequirements)
    ? event.roleRequirements
    : [];

  const matched = requirements.find(
    (item) => normalizeRole(item.role) === normalizeRole(role)
  );

  return matched ? Number(matched.quantityRequired || 0) : 0;
}

function canAutoApprovalStart(event = {}, now = new Date()) {
  if (!event || !event.eventDate || !event.createdAt) return false;

  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const eventDateMs = new Date(event.eventDate).getTime();
  const createdAtMs = new Date(event.createdAt).getTime();

  const isLastMinuteEvent = eventDateMs - nowMs < twoDaysMs;
  const waitedTwoDays = nowMs - createdAtMs >= twoDaysMs;

  return isLastMinuteEvent || waitedTwoDays;
}

module.exports = {
  normalizeRole,
  buildRoleRequirementsFromOrder,
  getRequiredQuantityForRole,
  canAutoApprovalStart,
};
