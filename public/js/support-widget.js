(() => {
  if (window.__blackEagleSupportWidgetLoaded) return;
  window.__blackEagleSupportWidgetLoaded = true;

  try {
    if (localStorage.getItem("adminToken")) return;
  } catch (error) {
    console.error("Support widget storage check failed:", error);
  }

  function safeParse(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function getCustomerSession() {
    const customer = safeParse(localStorage.getItem("customer"));
    if (!customer && !localStorage.getItem("customerEmail")) return null;

    const derivedName = `${String(customer?.firstName || "").trim()} ${String(
      customer?.lastName || ""
    ).trim()}`.trim();

    return {
      userId: String(customer?.id || "").trim(),
      name:
        String(customer?.name || "").trim() ||
        derivedName ||
        String(localStorage.getItem("customerName") || "").trim(),
      email:
        String(customer?.email || "").trim() ||
        String(localStorage.getItem("customerEmail") || "").trim(),
      role: "customer",
      userType: "",
    };
  }

  function getStaffSession() {
    const staffProfile = safeParse(localStorage.getItem("staffProfile"));
    if (!staffProfile && !localStorage.getItem("staffEmail")) return null;

    const derivedName = `${String(staffProfile?.firstName || "").trim()} ${String(
      staffProfile?.lastName || ""
    ).trim()}`.trim();

    return {
      userId: String(staffProfile?.id || "").trim(),
      name:
        String(staffProfile?.name || "").trim() ||
        derivedName ||
        String(localStorage.getItem("staffName") || "").trim(),
      email:
        String(staffProfile?.email || "").trim() ||
        String(localStorage.getItem("staffEmail") || "").trim(),
      role: "staff",
      userType: "",
    };
  }

  function getSession() {
    return getCustomerSession() || getStaffSession();
  }

  const style = document.createElement("style");
  style.textContent = `
    .be-support-widget{position:fixed;right:18px;bottom:18px;z-index:9999;font-family:Arial,sans-serif}
    .be-support-toggle{border:none;border-radius:999px;background:linear-gradient(135deg,#111827,#f4c542);color:#fff;padding:13px 18px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 14px 36px rgba(17,24,39,.28)}
    .be-support-panel{width:min(360px,calc(100vw - 24px));max-height:min(78vh,680px);overflow:auto;margin-top:12px;border-radius:18px;border:1px solid rgba(17,24,39,.08);background:#fff;color:#111827;box-shadow:0 22px 55px rgba(15,23,42,.22);display:none}
    .be-support-panel.open{display:block}
    .be-support-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 12px;border-bottom:1px solid #e5e7eb}
    .be-support-title{font-size:16px;font-weight:700}
    .be-support-close{border:none;background:transparent;color:#374151;cursor:pointer;font-size:20px;line-height:1}
    .be-support-body{padding:16px 18px 18px}
    .be-support-copy{font-size:13px;color:#4b5563;line-height:1.5;margin-bottom:14px}
    .be-support-session{margin-bottom:14px;padding:12px;border-radius:12px;background:#f9fafb;border:1px solid #e5e7eb;font-size:13px;line-height:1.5}
    .be-support-grid{display:grid;gap:10px}
    .be-support-field label{display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#374151}
    .be-support-field input,.be-support-field select,.be-support-field textarea{width:100%;border:1px solid #d1d5db;border-radius:12px;padding:11px 12px;font-size:14px;color:#111827;background:#fff}
    .be-support-field textarea{min-height:110px;resize:vertical}
    .be-support-actions{display:flex;gap:10px;margin-top:14px}
    .be-support-submit,.be-support-cancel{flex:1;border:none;border-radius:999px;padding:12px 14px;font-size:14px;font-weight:700;cursor:pointer}
    .be-support-submit{background:#111827;color:#fff}
    .be-support-cancel{background:#f3f4f6;color:#111827}
    .be-support-status{display:none;margin-top:12px;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.5}
    .be-support-status.show{display:block}
    .be-support-status.success{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
    .be-support-status.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
    @media (max-width:640px){.be-support-widget{right:12px;bottom:12px;left:12px}.be-support-toggle{width:100%}.be-support-panel{width:100%}}
  `;
  document.head.appendChild(style);

  const container = document.createElement("div");
  container.className = "be-support-widget";
  container.innerHTML = `
    <button type="button" class="be-support-toggle">Support</button>
    <div class="be-support-panel" aria-hidden="true">
      <div class="be-support-header">
        <div class="be-support-title">Support Chatbox V1</div>
        <button type="button" class="be-support-close" aria-label="Close support widget">×</button>
      </div>
      <div class="be-support-body">
        <p class="be-support-copy">Need help? Send a support message and the Black Eagle team will review it.</p>
        <div class="be-support-session"></div>
        <form class="be-support-form">
          <div class="be-support-grid">
            <div class="be-support-field be-guest-field">
              <label for="beSupportName">Name</label>
              <input id="beSupportName" name="name" type="text" />
            </div>
            <div class="be-support-field be-guest-field">
              <label for="beSupportEmail">Email</label>
              <input id="beSupportEmail" name="email" type="email" />
            </div>
            <div class="be-support-field be-guest-field">
              <label for="beSupportPhone">Phone (Optional)</label>
              <input id="beSupportPhone" name="phone" type="text" />
            </div>
            <div class="be-support-field be-guest-field">
              <label for="beSupportUserType">User Type</label>
              <select id="beSupportUserType" name="userType">
                <option value="">Select user type</option>
                <option value="customer-candidate">Customer Candidate</option>
                <option value="staff-candidate">Staff Candidate</option>
              </select>
            </div>
            <div class="be-support-field">
              <label for="beSupportMessage">Message</label>
              <textarea id="beSupportMessage" name="message" placeholder="Write your support request"></textarea>
            </div>
          </div>
          <div class="be-support-actions">
            <button type="submit" class="be-support-submit">Send</button>
            <button type="button" class="be-support-cancel">Close</button>
          </div>
          <div class="be-support-status"></div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const toggleButton = container.querySelector(".be-support-toggle");
  const panel = container.querySelector(".be-support-panel");
  const closeButton = container.querySelector(".be-support-close");
  const cancelButton = container.querySelector(".be-support-cancel");
  const form = container.querySelector(".be-support-form");
  const sessionBox = container.querySelector(".be-support-session");
  const statusBox = container.querySelector(".be-support-status");
  const guestFields = Array.from(container.querySelectorAll(".be-guest-field"));

  function showStatus(message, type) {
    statusBox.textContent = message;
    statusBox.className = `be-support-status show ${type}`;
  }

  function clearStatus() {
    statusBox.textContent = "";
    statusBox.className = "be-support-status";
  }

  function renderSession() {
    const session = getSession();

    if (session && session.email) {
      sessionBox.innerHTML = `<strong>Signed in as:</strong><br>${session.name || session.email}<br>${session.email}<br>Role: ${session.role}`;
      guestFields.forEach((field) => {
        field.style.display = "none";
      });
      return session;
    }

    sessionBox.innerHTML = "<strong>Not signed in</strong><br>Please enter your details before sending a support message.";
    guestFields.forEach((field) => {
      field.style.display = "block";
    });
    return null;
  }

  function setOpen(isOpen) {
    panel.classList.toggle("open", isOpen);
    panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    if (isOpen) {
      renderSession();
      clearStatus();
    }
  }

  toggleButton.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  closeButton.addEventListener("click", () => setOpen(false));
  cancelButton.addEventListener("click", () => setOpen(false));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    const session = renderSession();
    const formData = new FormData(form);
    const payload = {
      userId: session?.userId || "",
      name: session?.name || String(formData.get("name") || "").trim(),
      email: session?.email || String(formData.get("email") || "").trim().toLowerCase(),
      phone: String(formData.get("phone") || "").trim(),
      role: session?.role || "",
      userType: session?.userType || String(formData.get("userType") || "").trim(),
      message: String(formData.get("message") || "").trim(),
      sourcePage: `${window.location.pathname || "/"}${window.location.search || ""}`,
      priority: "Normal",
    };

    if (!payload.name || !payload.email || !payload.message || (!payload.role && !payload.userType)) {
      showStatus("Please complete the required support fields.", "error");
      return;
    }

    const submitButton = container.querySelector(".be-support-submit");
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";

    try {
      const response = await fetch("/api/support-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        showStatus(data.message || "Support message could not be sent.", "error");
        return;
      }

      form.reset();
      renderSession();
      showStatus("Your support message has been sent.", "success");
    } catch (error) {
      console.error("Support widget submit error:", error);
      showStatus("Server connection failed.", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Send";
    }
  });

  renderSession();
})();
