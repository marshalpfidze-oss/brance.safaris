document.addEventListener("DOMContentLoaded", () => {
  const loginPanel = document.getElementById("loginPanel");
  const dashboardPanel = document.getElementById("dashboardPanel");
  const loginForm = document.getElementById("loginForm");
  const filterForm = document.getElementById("filterForm");
  const loginButton = loginForm.querySelector('button[type="submit"]');
  const statusMessage = document.getElementById("adminStatus");
  const bookingList = document.getElementById("bookingList");
  const resultCount = document.getElementById("resultCount");
  const adminWelcome = document.getElementById("adminWelcome");
  const pagination = document.getElementById("pagination");
  const pageLabel = document.getElementById("pageLabel");
  const previousPage = document.getElementById("previousPage");
  const nextPage = document.getElementById("nextPage");
  const pageSize = 50;
  let bookingOffset = 0;

  const showMessage = (message, state = "") => {
    statusMessage.dataset.state = state;
    statusMessage.textContent = message;
  };

  const request = async (url, options = {}) => {
    let response;
    try {
      response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.method && options.method !== "GET"
            ? { "X-Admin-Action": "true" }
            : {}),
          ...options.headers
        }
      });
    } catch {
      throw new Error("The administrator service could not be reached. Check the server and try again.");
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    if (!body.trim()) {
      throw new Error(`The administrator service returned an empty response (HTTP ${response.status}).`);
    }
    if (!/(?:application\/json|\+json)(?:\s*;|$)/i.test(contentType)) {
      throw new Error(`The administrator service returned an unexpected response (HTTP ${response.status}).`);
    }

    let result;
    try {
      result = JSON.parse(body);
    } catch {
      throw new Error(`The administrator service returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(`The administrator service returned an unexpected JSON response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const message = typeof result.error === "string"
        ? result.error
        : typeof result.message === "string"
          ? result.message
          : `Request failed (HTTP ${response.status}).`;
      throw new Error(message);
    }
    return result;
  };

  const setSignedIn = (username) => {
    loginPanel.hidden = true;
    dashboardPanel.hidden = false;
    adminWelcome.textContent = `Signed in as ${username}.`;
    showMessage("");
    loadBookings();
  };

  const setSignedOut = () => {
    dashboardPanel.hidden = true;
    loginPanel.hidden = false;
    loginForm.reset();
    document.getElementById("adminUsername").focus();
  };

  const addText = (parent, label, value) => {
    const paragraph = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    paragraph.append(strong, document.createTextNode(value || "Not provided"));
    parent.append(paragraph);
  };

  const formatDate = (value) => {
    if (!value) return "Not specified";
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
  };

  const renderBooking = (booking) => {
    const card = document.createElement("article");
    card.className = "admin-booking-card";

    const heading = document.createElement("h2");
    heading.textContent = `${booking.reference} · ${booking.fullName}`;
    card.append(heading);

    const meta = document.createElement("div");
    meta.className = "admin-booking-meta";
    const statusBadge = document.createElement("span");
    statusBadge.className = "admin-badge";
    statusBadge.textContent = booking.status;
    const submitted = document.createElement("span");
    submitted.textContent = `Submitted ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(booking.createdAt))}`;
    const activityDate = document.createElement("span");
    activityDate.textContent = `Requested date: ${formatDate(booking.date)}`;
    meta.append(statusBadge, submitted, activityDate);
    card.append(meta);

    const details = document.createElement("div");
    details.className = "admin-card-grid";
    addText(details, "Service", booking.service);
    addText(details, "Service details", booking.serviceDetails);
    addText(details, "Email", booking.email);
    addText(details, "Phone", booking.phone);
    addText(details, "WhatsApp", booking.whatsapp);
    addText(details, "Preferred time", booking.preferredTime);
    addText(details, "Guests", `${booking.guests} (${booking.adults} adults, ${booking.children} children)`);
    addText(details, "Pickup / accommodation", booking.location);
    addText(details, "Special requests", booking.specialRequests);
    addText(details, "Business email", `${booking.businessEmailStatus} · ${booking.notificationAttempts} attempt(s)`);
    addText(details, "Customer email", `${booking.customerEmailStatus} · ${booking.customerNotificationAttempts} attempt(s)`);
    card.append(details);

    if (booking.lastNotificationError || booking.lastCustomerNotificationError) {
      const failure = document.createElement("p");
      failure.className = "admin-error";
      failure.textContent = [
        booking.lastNotificationError
          ? `Business notification: ${booking.lastNotificationError}`
          : "",
        booking.lastCustomerNotificationError
          ? `Customer confirmation: ${booking.lastCustomerNotificationError}`
          : ""
      ].filter(Boolean).join(" · ");
      card.append(failure);
    }

    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const statusSelect = document.createElement("select");
    statusSelect.className = "admin-status-select";
    statusSelect.setAttribute("aria-label", `Status for booking ${booking.reference}`);
    for (const value of ["pending", "confirmed", "cancelled", "completed"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value[0].toUpperCase() + value.slice(1);
      option.selected = value === booking.status;
      statusSelect.append(option);
    }

    const updateButton = document.createElement("button");
    updateButton.type = "button";
    updateButton.className = "admin-action";
    updateButton.textContent = "Update status";
    updateButton.addEventListener("click", async () => {
      updateButton.disabled = true;
      try {
        await request(`/api/admin/bookings/${encodeURIComponent(booking.reference)}/status`, {
          method: "PUT",
          body: JSON.stringify({ status: statusSelect.value })
        });
        await loadBookings();
        showMessage(`Booking ${booking.reference} status updated.`, "success");
      } catch (error) {
        showMessage(error.message, "error");
      } finally {
        updateButton.disabled = false;
      }
    });
    actions.append(statusSelect, updateButton);

    const emailNeedsRetry =
      ["failed", "pending"].includes(booking.businessEmailStatus) ||
      (booking.email && ["failed", "pending"].includes(booking.customerEmailStatus));
    if (emailNeedsRetry) {
      const retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.className = "admin-action";
      retryButton.textContent = "Retry failed email";
      retryButton.addEventListener("click", async () => {
        retryButton.disabled = true;
        try {
          const result = await request(
            `/api/admin/bookings/${encodeURIComponent(booking.reference)}/retry-email`,
            { method: "POST", body: "{}" }
          );
          await loadBookings();
          showMessage(result.message, "success");
        } catch (error) {
          await loadBookings();
          showMessage(error.message, "error");
        } finally {
          retryButton.disabled = false;
        }
      });
      actions.append(retryButton);
    }

    card.append(actions);
    return card;
  };

  async function loadBookings() {
    showMessage("Loading bookings...");
    const params = new URLSearchParams();
    const data = new FormData(filterForm);
    for (const key of ["q", "status", "dateFrom", "dateTo"]) {
      const value = String(data.get(key) || "").trim();
      if (value) params.set(key, value);
    }
    params.set("limit", String(pageSize));
    params.set("offset", String(bookingOffset));

    try {
      const result = await request(`/api/admin/bookings?${params.toString()}`);
      bookingList.replaceChildren();
      const firstResult = result.total ? bookingOffset + 1 : 0;
      const lastResult = Math.min(bookingOffset + result.bookings.length, result.total);
      resultCount.textContent =
        `Showing ${firstResult}–${lastResult} of ${result.total} booking${result.total === 1 ? "" : "s"}.`;
      pagination.hidden = result.total <= pageSize;
      pageLabel.textContent = `Page ${Math.floor(bookingOffset / pageSize) + 1} of ${Math.max(1, Math.ceil(result.total / pageSize))}`;
      previousPage.disabled = bookingOffset === 0;
      nextPage.disabled = bookingOffset + pageSize >= result.total;
      if (!result.bookings.length) {
        const empty = document.createElement("p");
        empty.className = "admin-empty";
        empty.textContent = "No bookings match these filters.";
        bookingList.append(empty);
      } else {
        for (const booking of result.bookings) {
          bookingList.append(renderBooking(booking));
        }
      }
      showMessage("");
    } catch (error) {
      showMessage(error.message, "error");
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    const fields = new FormData(loginForm);
    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
    showMessage("Checking administrator credentials...");
    try {
      const result = await request("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          username: String(fields.get("username")),
          password: String(fields.get("password"))
        })
      });
      setSignedIn(result.username);
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Sign in";
    }
  });

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    bookingOffset = 0;
    loadBookings();
  });

  previousPage.addEventListener("click", () => {
    bookingOffset = Math.max(0, bookingOffset - pageSize);
    loadBookings();
  });

  nextPage.addEventListener("click", () => {
    bookingOffset += pageSize;
    loadBookings();
  });

  document.getElementById("logoutButton").addEventListener("click", async () => {
    try {
      await request("/api/admin/logout", {
        method: "POST",
        body: "{}"
      });
      setSignedOut();
      showMessage("You have signed out.");
    } catch (error) {
      showMessage(error.message, "error");
    }
  });

  request("/api/admin/session")
    .then((session) => {
      if (session.authenticated) {
        setSignedIn(session.username);
      } else {
        setSignedOut();
      }
    })
    .catch((error) => {
      setSignedOut();
      showMessage(error.message, "error");
    });
});