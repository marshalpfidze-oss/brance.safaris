const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { afterEach, beforeEach, test } = require("node:test");
const {
  BUSINESS_EMAIL,
  SERVICES,
  createBookingApp,
  hashAdminPassword
} = require("./server");

const validBooking = {
  fullName: "Alex Traveller",
  email: "alex@example.com",
  phone: "+263 78 123 4567",
  whatsapp: "+263 78 123 4567",
  service: "Zambezi Game Drive",
  serviceDetails: "",
  date: "",
  preferredTime: "09:30",
  adults: 2,
  children: 1,
  location: "Victoria Falls hotel",
  specialRequests: "Vegetarian lunch"
};

const mailEnvironment = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "465",
  SMTP_USER: "sender@example.test",
  SMTP_PASS: "test-password",
  SMTP_FROM_EMAIL: "sender@example.test",
  CORS_ORIGIN: "https://brance.example.test",
  ADMIN_USERNAME: "booking-admin",
  ADMIN_PASSWORD_HASH: hashAdminPassword("SecureTestPassword2026!"),
  ADMIN_SESSION_SECRET: "test-session-secret-that-is-long-enough-for-hmac",
  CUSTOMER_SESSION_SECRET: "test-customer-session-secret-that-is-long-enough",
  PUBLIC_SITE_URL: "https://brance.example.test"
};

let context;
let server;
let baseUrl;

beforeEach(async () => {
  const sentMessages = [];
  const mailer = {
    failNext: false,
    async sendMail(message) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("simulated SMTP failure");
      }
      sentMessages.push(message);
      return { messageId: `test-${sentMessages.length}` };
    }
  };
  context = createBookingApp({
    databasePath: ":memory:",
    env: mailEnvironment,
    mailer
  });
  context.sentMessages = sentMessages;
  context.mailer = mailer;
  server = context.app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  if (context) {
    context.database.close();
    context = null;
  }
});

async function submitBooking(booking, key = crypto.randomUUID(), cookie) {
  return fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(booking)
  });
}

async function customerRequest(route, body, cookie) {
  const response = await fetch(`${baseUrl}/api/customer/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Customer-Action": "true",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
  return { response, result: await response.json() };
}

async function registerCustomer(overrides = {}) {
  const result = await customerRequest("signup", {
    fullName: "Casey Customer",
    email: "casey@example.test",
    password: "CustomerTestPassword2026!",
    ...overrides
  });
  return {
    ...result,
    cookie: result.response.headers.get("set-cookie")?.split(";")[0]
  };
}

async function loginCustomer(email = "casey@example.test", password = "CustomerTestPassword2026!") {
  const result = await customerRequest("login", { email, password });
  return {
    ...result,
    cookie: result.response.headers.get("set-cookie")?.split(";")[0]
  };
}

async function signInAdmin(username = mailEnvironment.ADMIN_USERNAME, password = "SecureTestPassword2026!") {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const result = await response.json();
  return {
    response,
    result,
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}

test("delivers business and customer emails with reference and booking details", async () => {
  const response = await submitBooking(validBooking);
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.match(response.headers.get("content-type"), /application\/json/i);
  assert.match(result.bookingReference, /^BTS-\d{8}-[A-F0-9]{6}$/);
  assert.match(result.message, /awaiting confirmation/);
  assert.equal(context.sentMessages.length, 2);
  assert.equal(context.sentMessages[0].to, BUSINESS_EMAIL);
  assert.match(context.sentMessages[0].text, new RegExp(result.bookingReference));
  assert.match(context.sentMessages[0].text, /Alex Traveller/);
  assert.match(context.sentMessages[0].text, /Total guests: 3/);
  assert.equal(context.sentMessages[1].to, "alex@example.com");
  assert.match(context.sentMessages[1].text, /not mean your booking is confirmed/);
  assert.equal(
    context.database.prepare("SELECT COUNT(*) AS count FROM bookings").get().count,
    1
  );
  assert.equal(
    context.database.prepare("SELECT business_email_status FROM bookings").get().business_email_status,
    "sent"
  );
});

test("rejects invalid bookings without sending email", async () => {
  const response = await submitBooking({ ...validBooking, adults: 0 });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type"), /application\/json/i);
  assert.match(result.error, /number of adults/);
  assert.equal(context.sentMessages.length, 0);
});

test("rejects booking without a phone or WhatsApp contact", async () => {
  const response = await submitBooking({
    ...validBooking,
    phone: "",
    whatsapp: ""
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /phone number or WhatsApp number/);
  assert.equal(context.sentMessages.length, 0);
});

test("returns a JSON error when the booking API route is missing", async () => {
  const response = await fetch(`${baseUrl}/api/missing`, { method: "POST" });
  const result = await response.json();

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /application\/json/i);
  assert.match(result.error, /Booking API route not found/);
});

test("rejects unsupported HTTP methods on the booking endpoint with JSON 405", async () => {
  const response = await fetch(`${baseUrl}/api/bookings`, { method: "GET" });
  const result = await response.json();

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
  assert.match(response.headers.get("content-type"), /application\/json/i);
  assert.match(result.error, /Use POST/);
});

test("allows POST preflight only from the configured frontend origin", async () => {
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://brance.example.test",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,idempotency-key"
    }
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://brance.example.test");
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
});

test("accepts same-origin POST without requiring CORS configuration", async () => {
  const sameOriginApp = createBookingApp({
    databasePath: ":memory:",
    env: mailEnvironment,
    mailer: context.mailer
  });
  const sameOriginServer = sameOriginApp.app.listen(0);

  try {
    await new Promise((resolve) => sameOriginServer.once("listening", resolve));
    const origin = `http://127.0.0.1:${sameOriginServer.address().port}`;
    const response = await fetch(`${origin}/api/bookings`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify(validBooking)
    });

    assert.equal(response.status, 201);
    assert.match(response.headers.get("content-type"), /application\/json/i);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await new Promise((resolve) => sameOriginServer.close(resolve));
    sameOriginApp.database.close();
  }
});

test("rejects unconfigured CORS origins with JSON 403", async () => {
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      Origin: "https://untrusted.example.test",
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID()
    },
    body: JSON.stringify(validBooking)
  });
  const result = await response.json();

  assert.equal(response.status, 403);
  assert.match(response.headers.get("content-type"), /application\/json/i);
  assert.match(result.error, /not allowed/);
  assert.equal(context.sentMessages.length, 0);
});

test("rejects non-POST cross-origin preflight with JSON 405", async () => {
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://brance.example.test",
      "Access-Control-Request-Method": "DELETE"
    }
  });
  const result = await response.json();

  assert.equal(response.status, 405);
  assert.match(response.headers.get("content-type"), /application\/json/i);
  assert.match(result.error, /Use POST/);
});

test("returns a JSON error for malformed booking JSON", async () => {
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID()
    },
    body: "{invalid json"
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type"), /application\/json/i);
  assert.match(result.error, /not valid JSON/);
});

test("does not report success when SMTP is missing and returns JSON", async () => {
  const unconfigured = createBookingApp({
    databasePath: ":memory:",
    env: {}
  });
  const unconfiguredServer = unconfigured.app.listen(0);

  try {
    await new Promise((resolve) => unconfiguredServer.once("listening", resolve));
    const response = await fetch(
      `http://127.0.0.1:${unconfiguredServer.address().port}/api/bookings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID()
        },
        body: JSON.stringify(validBooking)
      }
    );
    const result = await response.json();

    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /application\/json/i);
    assert.match(result.error, /could not send your booking notification/);
    assert.ok(result.bookingReference);
    assert.equal(
      unconfigured.database.prepare("SELECT COUNT(*) AS count FROM bookings").get().count,
      1
    );
  } finally {
    await new Promise((resolve) => unconfiguredServer.close(resolve));
    unconfigured.database.close();
  }
});

test("protects admin bookings and status changes behind login and CSRF checks", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/admin/bookings`);
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("content-type"), /application\/json/i);

  const invalidLogin = await signInAdmin("wrong-user", "IncorrectPassword2026!");
  assert.equal(invalidLogin.response.status, 401);
  assert.equal(invalidLogin.cookie, undefined);

  const login = await signInAdmin();
  assert.equal(login.response.status, 200);
  assert.match(login.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.response.headers.get("set-cookie"), /SameSite=Strict/);

  const missingCsrf = await fetch(`${baseUrl}/api/admin/bookings/example/status`, {
    method: "PUT",
    headers: {
      Cookie: login.cookie,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status: "confirmed" })
  });
  assert.equal(missingCsrf.status, 403);

  const saved = await submitBooking(validBooking);
  const savedResult = await saved.json();
  const list = await fetch(
    `${baseUrl}/api/admin/bookings?q=${encodeURIComponent(savedResult.bookingReference)}`,
    { headers: { Cookie: login.cookie } }
  );
  const listResult = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listResult.total, 1);
  assert.equal(listResult.bookings[0].reference, savedResult.bookingReference);
  assert.equal(listResult.bookings[0].businessEmailStatus, "sent");

  const statusUpdate = await fetch(
    `${baseUrl}/api/admin/bookings/${savedResult.bookingReference}/status`,
    {
      method: "PUT",
      headers: {
        Cookie: login.cookie,
        "Content-Type": "application/json",
        "X-Admin-Action": "true"
      },
      body: JSON.stringify({ status: "confirmed" })
    }
  );
  assert.equal(statusUpdate.status, 200);
  assert.deepEqual(await statusUpdate.json(), {
    reference: savedResult.bookingReference,
    status: "confirmed"
  });

  const invalidStatus = await fetch(
    `${baseUrl}/api/admin/bookings/${savedResult.bookingReference}/status`,
    {
      method: "PUT",
      headers: {
        Cookie: login.cookie,
        "Content-Type": "application/json",
        "X-Admin-Action": "true"
      },
      body: JSON.stringify({ status: "approved" })
    }
  );
  assert.equal(invalidStatus.status, 400);

  const logout = await fetch(`${baseUrl}/api/admin/logout`, {
    method: "POST",
    headers: {
      Cookie: login.cookie,
      "X-Admin-Action": "true"
    }
  });
  assert.equal(logout.status, 200);
  const session = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: logout.headers.get("set-cookie").split(";")[0] }
  });
  assert.equal((await session.json()).authenticated, false);
});

test("admin can retry a failed business email without duplicating a delivered notice", async () => {
  context.mailer.failNext = true;
  const response = await submitBooking(validBooking);
  const result = await response.json();
  assert.equal(response.status, 503);

  const login = await signInAdmin();
  context.mailer.failNext = true;
  const failedRetry = await fetch(
    `${baseUrl}/api/admin/bookings/${result.bookingReference}/retry-email`,
    {
      method: "POST",
      headers: {
        Cookie: login.cookie,
        "Content-Type": "application/json",
        "X-Admin-Action": "true"
      },
      body: "{}"
    }
  );
  const failedRetryResult = await failedRetry.json();
  assert.equal(failedRetry.status, 503);
  assert.equal(failedRetryResult.booking.businessEmailStatus, "failed");
  assert.equal(failedRetryResult.booking.notificationAttempts, 2);

  const retry = await fetch(
    `${baseUrl}/api/admin/bookings/${result.bookingReference}/retry-email`,
    {
      method: "POST",
      headers: {
        Cookie: login.cookie,
        "Content-Type": "application/json",
        "X-Admin-Action": "true"
      },
      body: "{}"
    }
  );
  const retryResult = await retry.json();

  assert.equal(retry.status, 200);
  assert.equal(retryResult.booking.businessEmailStatus, "sent");
  assert.equal(retryResult.booking.customerEmailStatus, "sent");
  assert.equal(context.sentMessages.filter((message) => message.to === BUSINESS_EMAIL).length, 1);
  assert.equal(context.sentMessages.filter((message) => message.to === validBooking.email).length, 1);
  assert.equal(
    context.database.prepare("SELECT notification_attempts FROM bookings").get().notification_attempts,
    3
  );
});

test("admin retry sends a failed customer receipt without resending business notice", async () => {
  const originalSendMail = context.mailer.sendMail.bind(context.mailer);
  context.mailer.sendMail = async (message) => {
    if (message.to === validBooking.email) throw new Error("simulated customer delivery failure");
    return originalSendMail(message);
  };

  const response = await submitBooking(validBooking);
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.customerEmailStatus, "failed");

  context.mailer.sendMail = originalSendMail;
  const login = await signInAdmin();
  const retry = await fetch(
    `${baseUrl}/api/admin/bookings/${result.bookingReference}/retry-email`,
    {
      method: "POST",
      headers: {
        Cookie: login.cookie,
        "Content-Type": "application/json",
        "X-Admin-Action": "true"
      },
      body: "{}"
    }
  );

  assert.equal(retry.status, 200);
  assert.equal(
    context.sentMessages.filter((message) => message.to === BUSINESS_EMAIL).length,
    1
  );
  assert.equal(
    context.sentMessages.filter((message) => message.to === validBooking.email).length,
    1
  );
  assert.equal(
    context.database.prepare("SELECT customer_notification_attempts FROM bookings").get().customer_notification_attempts,
    2
  );
});

test("booking database failures return JSON and do not send notification", async () => {
  context.database.exec("DROP TABLE bookings");
  const response = await submitBooking(validBooking);
  const result = await response.json();

  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type"), /application\/json/i);
  assert.match(result.error, /Something went wrong/);
  assert.equal(context.sentMessages.length, 0);
});

test("migrates existing booking databases without dropping saved bookings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "brance-booking-migration-"));
  const databasePath = path.join(directory, "bookings.sqlite");
  const original = new DatabaseSync(databasePath);
  original.exec(`
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      booking_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      business_email_status TEXT NOT NULL DEFAULT 'pending',
      customer_email_status TEXT NOT NULL DEFAULT 'pending'
    );
    INSERT INTO bookings (
      reference, idempotency_key, booking_json, created_at, business_email_status
    ) VALUES (
      'BTS-20261020-ABC123', 'legacy-request-key',
      '{"fullName":"Legacy Guest","email":"","phone":"+263 77 123 4567","whatsapp":"","service":"Zambezi Game Drive","serviceDetails":"","date":"","preferredTime":"","adults":1,"children":0,"guests":1,"location":"","specialRequests":""}',
      '2026-10-20T10:00:00.000Z', 'sent'
    );
  `);
  original.close();

  const migrated = createBookingApp({ databasePath, env: {} });
  try {
    const columns = migrated.database.prepare("PRAGMA table_info(bookings)")
      .all().map((column) => column.name);
    const saved = migrated.database.prepare(
      "SELECT reference, booking_status, notification_attempts, customer_notification_attempts FROM bookings"
    ).get();

    assert.ok(columns.includes("last_notification_error"));
    assert.ok(columns.includes("last_customer_notification_error"));
    assert.ok(columns.includes("customer_id"));
    assert.equal(saved.reference, "BTS-20261020-ABC123");
    assert.equal(saved.booking_status, "pending");
    assert.equal(saved.notification_attempts, 0);
    assert.equal(saved.customer_notification_attempts, 0);
    assert.equal(migrated.database.prepare("SELECT COUNT(*) AS count FROM bookings").get().count, 1);
    assert.equal(migrated.database.prepare("SELECT COUNT(*) AS count FROM customers").get().count, 0);
  } finally {
    migrated.database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("saves booking on email failure and retries without duplicate business notices", async () => {
  const idempotencyKey = crypto.randomUUID();
  context.mailer.failNext = true;

  const failedResponse = await submitBooking(validBooking, idempotencyKey);
  const failedResult = await failedResponse.json();
  assert.equal(failedResponse.status, 503);
  assert.ok(failedResult.bookingReference);

  const retryResponse = await submitBooking(validBooking, idempotencyKey);
  assert.equal(retryResponse.status, 201);
  assert.equal(context.sentMessages.filter((message) => message.to === BUSINESS_EMAIL).length, 1);
  assert.equal(context.sentMessages.filter((message) => message.to === "alex@example.com").length, 1);

  const duplicateResponse = await submitBooking(validBooking, idempotencyKey);
  assert.equal(duplicateResponse.status, 201);
  assert.equal(context.sentMessages.length, 2);
});

test("rejects reuse of an idempotency key with different booking details", async () => {
  const idempotencyKey = crypto.randomUUID();
  const firstResponse = await submitBooking(validBooking, idempotencyKey);
  assert.equal(firstResponse.status, 201);

  const changedResponse = await submitBooking(
    { ...validBooking, service: "Airport transfer" },
    idempotencyKey
  );
  const result = await changedResponse.json();

  assert.equal(changedResponse.status, 409);
  assert.match(result.error, /already used for different booking details/);
  assert.equal(context.sentMessages.length, 2);
});

test("allows a booking without customer email and sends only the business notification", async () => {
  const response = await submitBooking({ ...validBooking, email: "" });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(context.sentMessages.length, 1);
  assert.equal(context.sentMessages[0].to, BUSINESS_EMAIL);
  assert.match(result.message, /not yet confirmed/);
});

test("all linked website services are offered and accepted by the booking backend", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const frontend = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(html, /id="bookingForm"[^>]*method="post"[^>]*action="\/api\/bookings"/);
  assert.match(frontend, /fetch\(bookingForm\.action,\s*\{/);
  const linkedServices = [...html.matchAll(/data-tour="([^"]+)"/g)]
    .map((match) => match[1]);
  const offeredServices = [...html.matchAll(/<option value="([^"]+)"/g)]
    .map((match) => match[1]);

  for (const service of linkedServices) {
    assert.ok(offeredServices.includes(service), `missing service option: ${service}`);
    assert.ok(SERVICES.has(service), `backend rejects linked service: ${service}`);
  }
  for (const service of offeredServices.filter(Boolean)) {
    assert.ok(SERVICES.has(service), `backend rejects offered service: ${service}`);
  }
});

test("customer confirmation failure does not undo a delivered business notification", async () => {
  const originalSendMail = context.mailer.sendMail.bind(context.mailer);
  context.mailer.sendMail = async (message) => {
    if (message.to === "alex@example.com") throw new Error("simulated customer SMTP failure");
    return originalSendMail(message);
  };

  const response = await submitBooking(validBooking);
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(context.sentMessages.length, 1);
  assert.equal(context.sentMessages[0].to, BUSINESS_EMAIL);
  assert.match(result.message, /could not deliver the email confirmation/);
});

test("registers customers securely, links bookings, and returns only their own booking records", async () => {
  const registered = await registerCustomer();
  assert.equal(registered.response.status, 201);
  assert.match(registered.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(registered.response.headers.get("set-cookie"), /SameSite=Strict/);
  assert.deepEqual(registered.result.customer, {
    id: 1,
    fullName: "Casey Customer",
    email: "casey@example.test"
  });
  const storedCustomer = context.database.prepare(
    "SELECT email, password_hash FROM customers WHERE id = ?"
  ).get(registered.result.customer.id);
  assert.equal(storedCustomer.email, "casey@example.test");
  assert.match(storedCustomer.password_hash, /^scrypt\$/);
  assert.notEqual(storedCustomer.password_hash, "CustomerTestPassword2026!");

  const duplicate = await registerCustomer({ email: "CASEY@example.test" });
  assert.equal(duplicate.response.status, 409);
  const invalidPassword = await registerCustomer({ email: "short@example.test", password: "short" });
  assert.equal(invalidPassword.response.status, 400);
  const invalidLogin = await loginCustomer("casey@example.test", "IncorrectPassword2026!");
  assert.equal(invalidLogin.response.status, 401);
  assert.match(invalidLogin.result.error, /email or password is incorrect/);

  const sessionResponse = await fetch(`${baseUrl}/api/customer/session`, {
    headers: { Cookie: registered.cookie }
  });
  const session = await sessionResponse.json();
  assert.equal(session.authenticated, true);
  assert.equal(session.customer.email, "casey@example.test");

  const bookingResponse = await submitBooking(validBooking, crypto.randomUUID(), registered.cookie);
  const booking = await bookingResponse.json();
  assert.equal(bookingResponse.status, 201);
  assert.equal(
    context.database.prepare("SELECT customer_id FROM bookings WHERE reference = ?")
      .get(booking.bookingReference).customer_id,
    registered.result.customer.id
  );
  const ownBookingsResponse = await fetch(`${baseUrl}/api/customer/bookings`, {
    headers: { Cookie: registered.cookie }
  });
  const ownBookings = await ownBookingsResponse.json();
  assert.equal(ownBookingsResponse.status, 200);
  assert.equal(ownBookings.bookings.length, 1);
  assert.equal(ownBookings.bookings[0].reference, booking.bookingReference);
  assert.equal(ownBookings.bookings[0].status, "pending");

  const secondCustomer = await registerCustomer({
    fullName: "Jordan Customer",
    email: "jordan@example.test"
  });
  const secondBookingsResponse = await fetch(`${baseUrl}/api/customer/bookings`, {
    headers: { Cookie: secondCustomer.cookie }
  });
  const secondBookings = await secondBookingsResponse.json();
  assert.equal(secondBookingsResponse.status, 200);
  assert.equal(secondBookings.bookings.length, 0);

  const missingCsrf = await fetch(`${baseUrl}/api/customer/logout`, {
    method: "POST",
    headers: { Cookie: registered.cookie }
  });
  assert.equal(missingCsrf.status, 403);

  const secondDevice = await loginCustomer();
  assert.equal(secondDevice.response.status, 200);
  const logout = await customerRequest("logout", {}, registered.cookie);
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get("set-cookie"), /Max-Age=0/);
  const loggedOutSession = await fetch(`${baseUrl}/api/customer/session`, {
    headers: { Cookie: registered.cookie }
  });
  assert.equal((await loggedOutSession.json()).authenticated, false);
  const secondDeviceSession = await fetch(`${baseUrl}/api/customer/session`, {
    headers: { Cookie: secondDevice.cookie }
  });
  assert.equal((await secondDeviceSession.json()).authenticated, true);
});

test("customer password reset emails a single-use token and revokes previous sessions", async () => {
  const registered = await registerCustomer();
  const forgotten = await customerRequest("forgot-password", { email: "casey@example.test" });
  assert.equal(forgotten.response.status, 200);
  assert.match(forgotten.result.message, /If an account exists/);
  const resetMessage = context.sentMessages.at(-1);
  assert.equal(resetMessage.to, "casey@example.test");
  const resetUrl = resetMessage.text.match(/https:\/\/brance\.example\.test\/reset-password\.html\?token=([0-9a-f]{64})/);
  assert.ok(resetUrl);
  const resetToken = resetUrl[1];
  const storedToken = context.database.prepare(
    "SELECT token_hash FROM password_reset_tokens"
  ).get().token_hash;
  assert.equal(storedToken, crypto.createHash("sha256").update(resetToken).digest("hex"));
  assert.notEqual(storedToken, resetToken);

  const invalidPassword = await customerRequest("reset-password", {
    token: resetToken,
    password: "too-short"
  });
  assert.equal(invalidPassword.response.status, 400);
  const updated = await customerRequest("reset-password", {
    token: resetToken,
    password: "NewCustomerPassword2026!"
  });
  assert.equal(updated.response.status, 200);
  assert.match(updated.result.message, /password has been updated/);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM password_reset_tokens").get().count, 0);

  const oldSession = await fetch(`${baseUrl}/api/customer/session`, {
    headers: { Cookie: registered.cookie }
  });
  assert.equal((await oldSession.json()).authenticated, false);
  const oldPasswordLogin = await loginCustomer("casey@example.test", "CustomerTestPassword2026!");
  assert.equal(oldPasswordLogin.response.status, 401);
  const newPasswordLogin = await loginCustomer("casey@example.test", "NewCustomerPassword2026!");
  assert.equal(newPasswordLogin.response.status, 200);

  const reusedToken = await customerRequest("reset-password", {
    token: resetToken,
    password: "AnotherCustomerPassword2026!"
  });
  assert.equal(reusedToken.response.status, 400);
  const unknownEmail = await customerRequest("forgot-password", { email: "missing@example.test" });
  assert.equal(unknownEmail.result.message, forgotten.result.message);
});

test("rejects customer account requests from other origins and when auth is unconfigured", async () => {
  const crossOrigin = await fetch(`${baseUrl}/api/customer/signup`, {
    method: "POST",
    headers: {
      Origin: "https://attacker.example.test",
      "Content-Type": "application/json",
      "X-Customer-Action": "true"
    },
    body: JSON.stringify({
      fullName: "Casey Customer",
      email: "casey@example.test",
      password: "CustomerTestPassword2026!"
    })
  });
  assert.equal(crossOrigin.status, 403);

  const unconfigured = createBookingApp({ databasePath: ":memory:", env: {} });
  const unconfiguredServer = unconfigured.app.listen(0);
  try {
    await new Promise((resolve) => unconfiguredServer.once("listening", resolve));
    const response = await fetch(
      `http://127.0.0.1:${unconfiguredServer.address().port}/api/customer/signup`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Customer-Action": "true"
        },
        body: JSON.stringify({
          fullName: "Casey Customer",
          email: "casey@example.test",
          password: "CustomerTestPassword2026!"
        })
      }
    );
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/);
  } finally {
    await new Promise((resolve) => unconfiguredServer.close(resolve));
    unconfigured.database.close();
  }
});

test("customer login accepts POST and returns JSON 405 for an unsupported method", async () => {
  const registered = await registerCustomer();
  const validLogin = await loginCustomer();
  assert.equal(validLogin.response.status, 200);
  assert.equal(validLogin.result.authenticated, true);

  const invalidLogin = await loginCustomer("casey@example.test", "IncorrectPassword2026!");
  assert.equal(invalidLogin.response.status, 401);
  assert.match(invalidLogin.response.headers.get("content-type"), /application\/json/i);

  const wrongMethod = await fetch(`${baseUrl}/api/customer/login`, {
    method: "GET"
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  assert.match(wrongMethod.headers.get("content-type"), /application\/json/i);
  assert.match((await wrongMethod.json()).error, /Use POST/);

  const unknownRoute = await fetch(`${baseUrl}/api/customer/not-a-route`, {
    method: "GET"
  });
  assert.equal(unknownRoute.status, 404);
  assert.match(unknownRoute.headers.get("content-type"), /application\/json/i);
  assert.match((await unknownRoute.json()).error, /route not found/);

  const unauthenticatedBookings = await fetch(`${baseUrl}/api/customer/bookings`);
  assert.equal(unauthenticatedBookings.status, 401);
  assert.match((await unauthenticatedBookings.json()).error, /Sign in/);

  const customerCannotAccessAdmin = await fetch(`${baseUrl}/api/admin/bookings`, {
    headers: { Cookie: registered.cookie }
  });
  assert.equal(customerCannotAccessAdmin.status, 401);

  const staff = await signInAdmin();
  const adminCannotAccessCustomerBookings = await fetch(`${baseUrl}/api/customer/bookings`, {
    headers: { Cookie: staff.cookie }
  });
  assert.equal(adminCannotAccessCustomerBookings.status, 401);
});

test("serves the login assets and exposes a JSON backend health check", async () => {
  for (const page of ["/login.html", "/signup.html", "/dashboard.html", "/reset-password.html", "/customer.js"]) {
    const response = await fetch(`${baseUrl}${page}`);
    assert.equal(response.status, 200, `${page} should be served`);
  }
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get("content-type"), /application\/json/i);
  assert.deepEqual(await health.json(), {
    status: "ok",
    service: "brance-booking-api"
  });
});
