document.addEventListener("DOMContentLoaded", () => {
  const loginNav = document.getElementById("loginNav");
  const signupNav = document.getElementById("signupNav");
  const customerNav = document.getElementById("customerNav");
  const logoutButton = document.getElementById("customerLogout");

  const apiRequest = async (url, options = {}) => {
    let response;
    try {
      response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.method && options.method !== "GET"
            ? { "X-Customer-Action": "true" }
            : {}),
          ...options.headers
        }
      });
    } catch {
      throw new Error("We could not reach the account service. Check your connection and try again.");
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    if (!body.trim() || !/(?:application\/json|\+json)(?:\s*;|$)/i.test(contentType)) {
      throw new Error(
        `The account request did not reach the Node.js API (HTTP ${response.status}). ` +
        "Deploy the website with the Node.js backend and route /api/customer/* to that server."
      );
    }

    let result;
    try {
      result = JSON.parse(body);
    } catch {
      throw new Error(`The account service returned invalid data (HTTP ${response.status}).`);
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("The account service returned an unexpected response.");
    }
    if (!response.ok) {
      const message = typeof result.error === "string"
        ? result.error
        : `The request failed (HTTP ${response.status}).`;
      if ([404, 405].includes(response.status)) {
        throw new Error(
          `${message} Check that this website is served by the Node.js backend and that /api/customer/* is routed to it.`
        );
      }
      throw new Error(message);
    }
    return result;
  };

  const showStatus = (element, message, state = "") => {
    if (!element) return;
    element.dataset.state = state;
    element.textContent = message;
  };

  const setNavigation = (authenticated) => {
    if (loginNav) loginNav.hidden = authenticated;
    if (signupNav) signupNav.hidden = authenticated;
    if (customerNav) customerNav.hidden = !authenticated;
    if (logoutButton) logoutButton.hidden = !authenticated;
  };

  const setBusy = (button, busy, busyText, idleText) => {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
  };

  const bindForm = (form, button, status, busyText, idleText, handler) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity() || button.disabled) return;
      setBusy(button, true, busyText, idleText);
      showStatus(status, "");
      try {
        await handler(new FormData(form));
      } catch (error) {
        showStatus(status, error.message, "error");
      } finally {
        setBusy(button, false, busyText, idleText);
      }
    });
  };

  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.textContent = reveal ? "Hide" : "Show";
      button.setAttribute("aria-label", `${reveal ? "Hide" : "Show"} password`);
      button.setAttribute("aria-pressed", String(reveal));
    });
  });

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    const button = loginForm.querySelector('button[type="submit"]');
    const status = document.getElementById("loginStatus");
    bindForm(loginForm, button, status, "Logging in...", "Log in", async (formData) => {
      await apiRequest("/api/customer/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(formData.get("email")).trim(),
          password: String(formData.get("password"))
        })
      });
      setNavigation(true);
      window.location.assign("/dashboard.html");
    });
  }

  const signupForm = document.getElementById("signupForm");
  if (signupForm) {
    const password = document.getElementById("signupPassword");
    const confirmPassword = document.getElementById("confirmPassword");
    const validatePasswordMatch = () => {
      confirmPassword.setCustomValidity(password.value === confirmPassword.value
        ? ""
        : "The passwords do not match.");
    };
    password.addEventListener("input", validatePasswordMatch);
    confirmPassword.addEventListener("input", validatePasswordMatch);
    const button = signupForm.querySelector('button[type="submit"]');
    const status = document.getElementById("signupStatus");
    bindForm(signupForm, button, status, "Creating account...", "Create account", async (formData) => {
      if (formData.get("password") !== formData.get("confirmPassword")) {
        throw new Error("The passwords do not match.");
      }
      await apiRequest("/api/customer/signup", {
        method: "POST",
        body: JSON.stringify({
          fullName: String(formData.get("fullName")).trim(),
          email: String(formData.get("email")).trim(),
          password: String(formData.get("password"))
        })
      });
      setNavigation(true);
      window.location.assign("/dashboard.html");
    });
  }

  const forgotForm = document.getElementById("forgotPasswordForm");
  const resetForm = document.getElementById("resetPasswordForm");
  if (forgotForm) {
    const resetToken = new URLSearchParams(window.location.search).get("token");
    if (resetToken) {
      forgotForm.hidden = true;
      resetForm.hidden = false;
      document.getElementById("resetIntro").textContent =
        "Choose a new password. Reset links can only be used once and expire after 30 minutes.";
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    const button = forgotForm.querySelector('button[type="submit"]');
    const status = document.getElementById("resetStatus");
    bindForm(forgotForm, button, status, "Sending...", "Send reset link", async (formData) => {
      const result = await apiRequest("/api/customer/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: String(formData.get("email")).trim() })
      });
      showStatus(status, result.message, "success");
    });

    if (resetForm) {
      const button = resetForm.querySelector('button[type="submit"]');
      const password = document.getElementById("newPassword");
      const confirmPassword = document.getElementById("newPasswordConfirm");
      const validatePasswordMatch = () => {
        confirmPassword.setCustomValidity(password.value === confirmPassword.value
          ? ""
          : "The passwords do not match.");
      };
      password.addEventListener("input", validatePasswordMatch);
      confirmPassword.addEventListener("input", validatePasswordMatch);
      bindForm(resetForm, button, status, "Updating...", "Update password", async (formData) => {
        if (formData.get("password") !== formData.get("confirmPassword")) {
          throw new Error("The passwords do not match.");
        }
        const result = await apiRequest("/api/customer/reset-password", {
          method: "POST",
          body: JSON.stringify({
            token: resetToken || "",
            password: String(formData.get("password"))
          })
        });
        resetForm.hidden = true;
        showStatus(status, result.message, "success");
      });
    }
  }

  const dashboard = document.getElementById("customerBookings");
  if (dashboard) {
    const status = document.getElementById("dashboardStatus");
    apiRequest("/api/customer/session")
      .then((result) => {
        if (!result.authenticated || !result.customer) {
          window.location.replace("/login.html");
          return;
        }
        setNavigation(true);
        document.getElementById("customerWelcome").textContent =
          `${result.customer.fullName} · ${result.customer.email}`;
        return apiRequest("/api/customer/bookings").then((bookingsResult) => {
          dashboard.replaceChildren();
          if (bookingsResult.bookings.length === 0) {
            showStatus(status, "You have no booking requests yet. Start planning your trip whenever you’re ready.");
            return;
          }
          showStatus(status, `You have ${bookingsResult.bookings.length} booking request${bookingsResult.bookings.length === 1 ? "" : "s"}.`);
          bookingsResult.bookings.forEach((booking) => {
            const card = document.createElement("article");
            card.className = "customer-booking-card";
            const heading = document.createElement("h2");
            heading.textContent = booking.service;
            const reference = document.createElement("p");
            reference.className = "booking-reference";
            reference.textContent = `Reference: ${booking.reference}`;
            const requestedDate = document.createElement("p");
            requestedDate.textContent = `Requested date: ${booking.date || "Not specified"}`;
            const guests = document.createElement("p");
            guests.textContent = `Guests: ${booking.guests} (${booking.adults} adults, ${booking.children} children)`;
            const bookingStatus = document.createElement("p");
            bookingStatus.className = `booking-status booking-status-${booking.status}`;
            bookingStatus.textContent = `Status: ${booking.status}`;
            const confirmation = document.createElement("p");
            confirmation.textContent = booking.status === "pending"
              ? "Awaiting confirmation from Brance Tours & Safaris."
              : `Booking status updated by Brance Tours & Safaris: ${booking.status}.`;
            card.append(heading, reference, requestedDate, guests, bookingStatus, confirmation);
            dashboard.append(card);
          });
        });
      })
      .catch((error) => showStatus(status, error.message, "error"));
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      try {
        await apiRequest("/api/customer/logout", { method: "POST" });
        setNavigation(false);
        window.location.assign("/");
      } catch (error) {
        const status = document.getElementById("dashboardStatus") ||
          document.getElementById("loginStatus");
        showStatus(status, error.message, "error");
      } finally {
        logoutButton.disabled = false;
      }
    });
  }

  apiRequest("/api/customer/session")
    .then((result) => {
      setNavigation(Boolean(result.authenticated));
      if (result.authenticated &&
          (window.location.pathname === "/login.html" ||
           window.location.pathname === "/signup.html")) {
        window.location.replace("/dashboard.html");
        return;
      }
      const bookingForm = document.getElementById("bookingForm");
      if (result.authenticated && result.customer && bookingForm) {
        const name = bookingForm.elements.namedItem("name");
        const email = bookingForm.elements.namedItem("email");
        if (name && !name.value) name.value = result.customer.fullName;
        if (email && !email.value) email.value = result.customer.email;
      }
    })
    .catch(() => setNavigation(false));
});
