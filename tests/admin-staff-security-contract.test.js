const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const dashboardSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "dashboard.html"),
  "utf8"
);

test("staff detail route requires both admin authentication and superadmin role", () => {
  assert.match(
    serverSource,
    /"\/admin\/staff\/:id\/details",\s*requireAdminAuth,\s*requireSuperAdmin/
  );
});

test("legacy staff report response keys and row fields remain available", () => {
  const reportRoute = serverSource.slice(
    serverSource.indexOf('app.get("/admin/staff-report"'),
    serverSource.indexOf('"/admin/staff/:id/details"')
  );
  for (const responseField of ["success", "count"]) {
    assert.match(reportRoute, new RegExp(`${responseField}:`));
  }
  assert.match(reportRoute, /\n\s*summary,\s*\n\s*rows,/);
  for (const rowField of [
    "staffId", "fullName", "email", "mobile", "status", "profession",
    "postcode", "city", "region", "address", "experience", "averageRating",
    "feedbackCount", "applicationsCount", "approvedApplicationsCount",
    "assignmentsCount", "completedAssignmentsCount", "createdAt",
  ]) {
    assert.match(reportRoute, new RegExp(`${rowField}:`));
  }
  assert.match(reportRoute, /format !== "csv" && paginationRequested/);
});

test("staff detail route disables response caching", () => {
  assert.match(serverSource, /res\.setHeader\("Cache-Control", "no-store"\)/);
});

test("staff detail query uses an explicit projection without secret fields", () => {
  const detailRoute = serverSource.slice(
    serverSource.indexOf('"/admin/staff/:id/details"'),
    serverSource.indexOf("async function handleCustomerForgotPassword")
  );

  assert.match(detailRoute, /Staff\.findById\(req\.params\.id, \{/);
  for (const forbidden of [
    "passwordHash", "adminAuthTokenHash", "verifyCode", "setupToken", "resetToken",
  ]) {
    assert.equal(detailRoute.includes(`${forbidden}: 1`), false);
  }
  assert.equal(/\bpassword\s*:\s*1\b/.test(detailRoute), false);
});

test("staff list response does not serialize sensitive staff fields", () => {
  const reportRoute = serverSource.slice(
    serverSource.indexOf('app.get("/admin/staff-report"'),
    serverSource.indexOf('"/admin/staff/:id/details"')
  );
  const rowSerializer = reportRoute.slice(
    reportRoute.indexOf("return {"),
    reportRoute.indexOf("const summary")
  );

  for (const forbidden of ["niNumber", "dob", "selfieData", "password", "verifyCode", "resetToken"]) {
    assert.equal(rowSerializer.includes(forbidden), false);
  }
  assert.equal(rowSerializer.includes("bankDetails:"), false);
});

test("staff report renderer creates user cells with textContent", () => {
  assert.match(dashboardSource, /function renderStaffRows\(\)/);
  assert.match(dashboardSource, /element\.textContent =/);
  const renderBlock = dashboardSource.slice(
    dashboardSource.indexOf("function renderStaffRows()"),
    dashboardSource.indexOf("function updateStaffPagination()")
  );
  assert.equal(renderBlock.includes("innerHTML"), false);

  const detailsBlock = dashboardSource.slice(
    dashboardSource.indexOf("function createWorkSection("),
    dashboardSource.indexOf("async function openStaffDetails(")
  );
  assert.equal(detailsBlock.includes("innerHTML"), false);
  assert.match(detailsBlock, /textContent/);
});

test("staff filter builder keeps pagination out of CSV and includes supported filters", () => {
  const filterBlock = dashboardSource.slice(
    dashboardSource.indexOf("function buildStaffReportParams("),
    dashboardSource.indexOf("function appendStaffCell(")
  );
  for (const filterName of [
    "search", "email", "mobile", "role", "position", "status", "bankDetailsMissing",
    "city", "postcode", "createdFrom", "createdTo", "sortBy", "sortOrder",
  ]) {
    assert.match(filterBlock, new RegExp(`${filterName}:`));
  }
  assert.match(filterBlock, /if \(csv\)[\s\S]*format[\s\S]*else[\s\S]*page[\s\S]*limit/);
});
