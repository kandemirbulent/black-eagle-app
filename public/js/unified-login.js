(() => {
  const form = document.getElementById("unifiedLoginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const messageBox = document.getElementById("messageBox");
  const loginBtn = document.getElementById("loginBtn");

  if (!form || !emailInput || !passwordInput || !messageBox || !loginBtn) {
    return;
  }

  function setMessage(message, type = "error") {
    messageBox.textContent = message;
    messageBox.className = `message ${type}`;
  }

  function setLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loginBtn.textContent = isLoading ? "Logging in..." : "Login";
  }

  async function tryStaffLogin(email, password) {
    const response = await fetch("/api/staff/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function tryCustomerLogin(email, password) {
    const response = await fetch("/customer-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();

    setMessage("");

    if (!email || !password) {
      setMessage("Please enter both email and password.");
      return;
    }

    try {
      setLoading(true);

      const staffResult = await tryStaffLogin(email, password);

      if (staffResult.response.ok && staffResult.data.success) {
        localStorage.setItem("staffEmail", email);

        if (staffResult.data.staff?.name) {
          localStorage.setItem("staffName", staffResult.data.staff.name);
        }

        setMessage("Staff login successful. Redirecting...", "success");

        setTimeout(() => {
          const redirectUrl = staffResult.data.redirect || "/staff-logins/staff-dashboard.html";
          window.location.href = `${redirectUrl}?email=${encodeURIComponent(email)}`;
        }, 500);

        return;
      }

      const customerResult = await tryCustomerLogin(email, password);

      if (customerResult.response.ok && customerResult.data.success) {
        localStorage.setItem("customerEmail", email);

        if (customerResult.data.customer?.name) {
          localStorage.setItem("customerName", customerResult.data.customer.name);
        }

        if (customerResult.data.customer?.applicationId) {
          localStorage.setItem("appId", customerResult.data.customer.applicationId);
        }

        if (customerResult.data.customer?.customerCode) {
          localStorage.setItem("customerCode", customerResult.data.customer.customerCode);
        }

        if (customerResult.data.customer) {
          localStorage.setItem("customer", JSON.stringify(customerResult.data.customer));
        }

        setMessage("Customer login successful. Redirecting...", "success");

        setTimeout(() => {
          const redirectUrl = customerResult.data.redirect || "/Customer-logins/customer-dashboard.html";
          window.location.href = redirectUrl;
        }, 500);

        return;
      }

      setMessage(
        staffResult.data.message ||
          customerResult.data.message ||
          "User not found or password is incorrect."
      );
      setLoading(false);
    } catch (error) {
      console.error("Unified login error:", error);
      setMessage("Server connection failed.");
      setLoading(false);
    }
  });
})();
