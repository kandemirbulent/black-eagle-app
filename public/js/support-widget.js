(() => {
  if (window.__blackEagleSupportWidgetLoaded) return;
  window.__blackEagleSupportWidgetLoaded = true;

  const LANGUAGE_STORAGE_KEY = "preferredLanguage";
  const DEFAULT_LANGUAGE = "en";
  const SUPPORTED_LANGUAGES = new Set(["en", "tr"]);

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

  function getCurrentPath() {
    return String(window.location.pathname || "/").trim().toLowerCase();
  }

  function isCustomerContext() {
    const path = getCurrentPath();
    return [
      "/customer-logins/customer-dashboard.html",
      "/customer-logins/create-order.html",
      "/event-detail.html",
      "/invoice.html",
      "/order-detail.html",
      "/payment.html",
      "/success.html",
      "/cancel.html",
    ].includes(path);
  }

  function isStaffContext() {
    const path = getCurrentPath();
    return [
      "/staff-logins/staff-dashboard.html",
    ].includes(path);
  }

  function getCustomerSession() {
    if (!isCustomerContext()) return null;

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
    if (!isStaffContext()) return null;

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
    if (isCustomerContext()) {
      return getCustomerSession();
    }

    if (isStaffContext()) {
      return getStaffSession();
    }

    return null;
  }

  const SUPPORT_ASSISTANT_NAMES = [
    "Daniel",
    "James",
    "Oliver",
    "George",
    "William",
    "Emily",
    "Sophie",
    "Olivia",
    "Amelia",
    "Charlotte",
  ];

  const TURKISH_SUPPORT_ASSISTANT_NAMES = [
    "Ayse",
    "Fatma",
    "Elif",
    "Zeynep",
    "Merve",
    "Mehmet",
    "Ahmet",
    "Mustafa",
    "Emre",
    "Burak",
  ];

  const WIDGET_TEXT = {
    en: {
      toggle: "Support",
      title: "Support Chat",
      closeAria: "Close support widget",
      copy: "Need help? Send a support message and the Black Eagle team will review it.",
      agentRole: "Black Eagle Support Assistant",
      name: "Name",
      email: "Email",
      phone: "Phone (Optional)",
      userType: "User Type",
      userTypePlaceholder: "Select user type",
      userTypeCustomer: "Customer Candidate",
      userTypeStaff: "Staff Candidate",
      message: "Message",
      messagePlaceholder: "Write your support request",
      send: "Send",
      sending: "Sending...",
      close: "Close",
      welcome: (name) => `Hello, my name is ${name} from Black Eagle Support. How can I help you today?`,
      signedInAs: "Signed in as:",
      role: "Role",
      notSignedIn: "Not signed in",
      notSignedInCopy: "Please enter your details before sending a support message.",
      requiredFields: "Please complete the required support fields.",
      sendFailed: "Support message could not be sent.",
      sentSuccess: "Your support message has been sent.",
      serverFailed: "Server connection failed.",
    },
    tr: {
      toggle: "Destek",
      title: "Destek Sohbeti",
      closeAria: "Destek penceresini kapat",
      copy: "Yardima mi ihtiyaciniz var? Bir destek mesaji gonderin, Black Eagle ekibi inceleyip size donsun.",
      agentRole: "Black Eagle Destek Temsilcisi",
      name: "Ad Soyad",
      email: "E-posta",
      phone: "Telefon (Istege Bagli)",
      userType: "Kullanici Tipi",
      userTypePlaceholder: "Kullanici tipi secin",
      userTypeCustomer: "Musteri Adayi",
      userTypeStaff: "Personel Adayi",
      message: "Mesaj",
      messagePlaceholder: "Destek talebinizi yazin",
      send: "Gonder",
      sending: "Gonderiliyor...",
      close: "Kapat",
      welcome: (name) => `Merhaba, ben Black Eagle destek ekibinden ${name}. Size nasil yardimci olabilirim?`,
      signedInAs: "Giris yapan kullanici:",
      role: "Rol",
      notSignedIn: "Giris yapilmamis",
      notSignedInCopy: "Destek mesaji gondermeden once bilgilerinizi girin.",
      requiredFields: "Lutfen gerekli destek alanlarini doldurun.",
      sendFailed: "Destek mesaji gonderilemedi.",
      sentSuccess: "Destek mesajiniz gonderildi.",
      serverFailed: "Sunucu baglantisi kurulamadi.",
    },
  };

  function getLanguage() {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      return SUPPORTED_LANGUAGES.has(stored) ? stored : DEFAULT_LANGUAGE;
    } catch (error) {
      return DEFAULT_LANGUAGE;
    }
  }

  function getText(key) {
    const language = getLanguage();
    return WIDGET_TEXT[language]?.[key] ?? WIDGET_TEXT.en[key];
  }

  const style = document.createElement("style");
  style.textContent = `
    .be-support-widget{position:fixed;right:18px;bottom:max(18px,env(safe-area-inset-bottom));z-index:10001;font-family:Arial,sans-serif}
    .be-support-toggle{border:none;border-radius:999px;background:linear-gradient(135deg,#111827,#f4c542);color:#fff;padding:13px 18px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 14px 36px rgba(17,24,39,.28)}
    .be-support-panel{width:min(360px,calc(100vw - 24px));max-height:min(78vh,680px);overflow:auto;margin-top:12px;border-radius:18px;border:1px solid rgba(17,24,39,.08);background:#fff;color:#111827;box-shadow:0 22px 55px rgba(15,23,42,.22);display:none}
    .be-support-panel.open{display:block}
    .be-support-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 12px;border-bottom:1px solid #e5e7eb}
    .be-support-title{font-size:16px;font-weight:700}
    .be-support-close{border:none;background:transparent;color:#374151;cursor:pointer;font-size:20px;line-height:1}
    .be-support-body{padding:16px 18px 18px}
    .be-support-copy{font-size:13px;color:#4b5563;line-height:1.5;margin-bottom:14px}
    .be-support-welcome{margin-bottom:14px;padding:14px;border-radius:14px;background:#f9fafb;border:1px solid #e5e7eb}
    .be-support-agent{display:flex;align-items:center;gap:10px;margin-bottom:8px}
    .be-support-agent-badge{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:999px;background:#111827;color:#fff;font-size:14px;font-weight:700}
    .be-support-agent-name{font-size:14px;font-weight:700;color:#111827}
    .be-support-agent-role{font-size:12px;color:#6b7280}
    .be-support-welcome-message{font-size:14px;line-height:1.6;color:#111827;margin:0 0 10px}
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
    @media (max-width:640px){.be-support-widget{right:12px;bottom:max(12px,env(safe-area-inset-bottom));left:12px}.be-support-toggle{width:100%}.be-support-panel{width:100%}}
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
        <div class="be-support-welcome">
          <div class="be-support-agent">
            <div class="be-support-agent-badge">D</div>
            <div>
              <div class="be-support-agent-name"></div>
              <div class="be-support-agent-role">Black Eagle Support Assistant</div>
            </div>
          </div>
          <p class="be-support-welcome-message"></p>
        </div>
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
  const assistantNameBox = container.querySelector(".be-support-agent-name");
  const welcomeMessageBox = container.querySelector(".be-support-welcome-message");
  const assistantBadgeBox = container.querySelector(".be-support-agent-badge");
  const titleBox = container.querySelector(".be-support-title");
  const copyBox = container.querySelector(".be-support-copy");
  const agentRoleBox = container.querySelector(".be-support-agent-role");
  const nameLabel = container.querySelector('label[for="beSupportName"]');
  const emailLabel = container.querySelector('label[for="beSupportEmail"]');
  const phoneLabel = container.querySelector('label[for="beSupportPhone"]');
  const userTypeLabel = container.querySelector('label[for="beSupportUserType"]');
  const messageLabel = container.querySelector('label[for="beSupportMessage"]');
  const userTypeSelect = container.querySelector("#beSupportUserType");
  const userTypeOptions = userTypeSelect ? Array.from(userTypeSelect.options) : [];
  const messageInput = container.querySelector("#beSupportMessage");
  const submitButton = container.querySelector(".be-support-submit");
  let currentAssistantName = "";

  function pickRandomAssistantName() {
    const names = getLanguage() === "tr" ? TURKISH_SUPPORT_ASSISTANT_NAMES : SUPPORT_ASSISTANT_NAMES;
    const index = Math.floor(Math.random() * names.length);
    return names[index];
  }

  function renderAssistantIdentity() {
    if (!currentAssistantName) {
      currentAssistantName = pickRandomAssistantName();
    }

    assistantNameBox.textContent = currentAssistantName;
    assistantBadgeBox.textContent = currentAssistantName.slice(0, 1).toUpperCase();
    welcomeMessageBox.textContent = getText("welcome")(currentAssistantName);
  }

  function renderWidgetText() {
    toggleButton.textContent = getText("toggle");
    titleBox.textContent = getText("title");
    closeButton.setAttribute("aria-label", getText("closeAria"));
    copyBox.textContent = getText("copy");
    agentRoleBox.textContent = getText("agentRole");
    nameLabel.textContent = getText("name");
    emailLabel.textContent = getText("email");
    phoneLabel.textContent = getText("phone");
    userTypeLabel.textContent = getText("userType");
    if (userTypeOptions[0]) userTypeOptions[0].textContent = getText("userTypePlaceholder");
    if (userTypeOptions[1]) userTypeOptions[1].textContent = getText("userTypeCustomer");
    if (userTypeOptions[2]) userTypeOptions[2].textContent = getText("userTypeStaff");
    messageLabel.textContent = getText("message");
    messageInput.setAttribute("placeholder", getText("messagePlaceholder"));
    submitButton.textContent = submitButton.disabled ? getText("sending") : getText("send");
    cancelButton.textContent = getText("close");
    renderAssistantIdentity();
  }

  function showStatus(message, type) {
    statusBox.textContent = message;
    statusBox.className = `be-support-status show ${type}`;
  }

  function clearStatus() {
    statusBox.textContent = "";
    statusBox.className = "be-support-status";
  }

  function formatRole(role) {
    if (getLanguage() !== "tr") return role;
    if (role === "customer") return "musteri";
    if (role === "staff") return "personel";
    return role;
  }

  function renderSession() {
    const session = getSession();

    if (session && session.email) {
      sessionBox.innerHTML = `<strong>${getText("signedInAs")}</strong><br>${session.name || session.email}<br>${session.email}<br>${getText("role")}: ${formatRole(session.role)}`;
      guestFields.forEach((field) => {
        field.style.display = "none";
      });
      return session;
    }

    sessionBox.innerHTML = `<strong>${getText("notSignedIn")}</strong><br>${getText("notSignedInCopy")}`;
    guestFields.forEach((field) => {
      field.style.display = "block";
    });
    return null;
  }

  function setOpen(isOpen) {
    panel.classList.toggle("open", isOpen);
    panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    if (isOpen) {
      if (!currentAssistantName) {
        renderAssistantIdentity();
      }
      renderWidgetText();
      renderSession();
      clearStatus();
    } else {
      currentAssistantName = "";
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
      showStatus(getText("requiredFields"), "error");
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = getText("sending");

    try {
      const response = await fetch("/api/support-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        const errorMessage = getLanguage() === "tr" ? getText("sendFailed") : (data.message || getText("sendFailed"));
        showStatus(errorMessage, "error");
        return;
      }

      form.reset();
      renderSession();
      showStatus(getText("sentSuccess"), "success");
    } catch (error) {
      console.error("Support widget submit error:", error);
      showStatus(getText("serverFailed"), "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = getText("send");
    }
  });

  document.querySelectorAll("[data-language-option]").forEach((button) => {
    button.addEventListener("click", () => {
      window.setTimeout(() => {
        currentAssistantName = "";
        renderWidgetText();
        renderSession();
      }, 0);
    });
  });

  window.addEventListener("storage", (event) => {
    if (event.key === LANGUAGE_STORAGE_KEY) {
      currentAssistantName = "";
      renderWidgetText();
      renderSession();
    }
  });

  renderWidgetText();
  renderAssistantIdentity();
  renderSession();
})();
