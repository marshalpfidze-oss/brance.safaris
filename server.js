const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const express = require("express");
const nodemailer = require("nodemailer");
require("dotenv").config();

const ROOT = __dirname;
const BUSINESS_EMAIL = "brancetoursandsafaris@gmail.com";
const SERVICES = new Set([
  "Zambezi Game Drive",
  "RIDING QUARD BIKES",
  "Rafting (White-Water Rafting)",
  "Braai (BBQ) Safari",
  "Zip Line Experience",
  "Helicopter Tours / Microlight Flights",
  "Geological Formations",
  "Boma dinner and Drum Show",
  "Jet Boat & Jet Ski",
  "Full Day Chobe National Park Excursion",
  "VILLAGE TOUR",
  "Bamba Tram Safari",
  "Helicopter tours",
  "village tour",
  "High Tea Safari",
  "Gin & Tonic Safari",
  "Baobab & Vulture Experience",
  "Guided Town Safari",
  "Chobe Day Trip",
  "Chobe Overnight Safari",
  "Hwange Safari",
  "Victoria Falls Guided Tour",
  "Guided Rainforest Walk",
  "The Outlook (Accommodation)",
  "The Little Outlook (Accommodation)",
  "Spring Villa Guest Lodge and Campsite (Accommodation)",
  "Bethel Lodgings (Accommodation)",
  "Airport transfer",
  "Other service"
]);
const MAX_REQUESTS = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_SESSION_COOKIE = "bts_admin_session";
const CUSTOMER_SESSION_COOKIE = "bts_customer_session";
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const CUSTOMER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const BOOKING_STATUSES = new Set(["pending", "confirmed", "cancelled", "completed"]);

function cleanString(value, maximumLength) {
  return typeof value === "string" && value.length <= maximumLength
    ? value.trim()
    : null;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateBooking(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Please submit valid booking details." };
  }

  const fullName = cleanString(input.fullName, 120);
  const email = cleanString(input.email || "", 254);
  const phone = cleanString(input.phone || "", 30);
  const whatsapp = cleanString(input.whatsapp || "", 30);
  const service = cleanString(input.service, 120);
  const date = cleanString(input.date || "", 10);
  const preferredTime = cleanString(input.preferredTime || "", 5);
  const location = cleanString(input.location || "", 200);
  const specialRequests = cleanString(input.specialRequests || "", 2000);
  const serviceDetails = cleanString(input.serviceDetails || "", 200);
  const adults = input.adults;
  const children = input.children;

  if (!fullName || fullName.length < 2) {
    return { error: "Enter your full name (at least 2 characters)." };
  }
  if (email === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { error: "Enter a valid email address, or leave it blank." };
  }
  if (phone === null || (phone && !/^[+0-9(). -]{5,30}$/.test(phone))) {
    return { error: "Enter a valid phone number, or leave it blank." };
  }
  if (whatsapp === null || (whatsapp && !/^[+0-9(). -]{5,30}$/.test(whatsapp))) {
    return { error: "Enter a valid WhatsApp number, or leave it blank." };
  }
  if (!phone && !whatsapp) {
    return { error: "Enter a phone number or WhatsApp number so the team can contact you." };
  }
  if (!service || !SERVICES.has(service)) {
    return { error: "Select a service from the available options." };
  }
  if (service === "Other service" && (!serviceDetails || serviceDetails.length < 2)) {
    return { error: "Please describe the service you would like to book." };
  }
  if (date && (!isValidDate(date) || date < new Date().toISOString().slice(0, 10))) {
    return { error: "Choose a valid date that is not in the past." };
  }
  if (preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) {
    return { error: "Enter a valid preferred time." };
  }
  if (location === null || specialRequests === null || serviceDetails === null) {
    return { error: "One or more booking details are too long." };
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > 99) {
    return { error: "Enter a valid number of adults (1–99)." };
  }
  if (!Number.isInteger(children) || children < 0 || children > 99 || adults + children > 99) {
    return { error: "Enter a valid number of children (0–99); total guests cannot exceed 99." };
  }

  return {
    booking: {
      fullName,
      email,
      phone,
      whatsapp,
      service,
      serviceDetails,
      date,
      preferredTime,
      adults,
      children,
      guests: adults + children,
      location,
      specialRequests
    }
  };
}

function formatBooking(booking, reference, submittedAt) {
  return [
    "BRANCE TOURS & SAFARIS — NEW BOOKING REQUEST",
    "",
    `Booking reference: ${reference}`,
    `Submitted: ${submittedAt}`,
    "",
    `Customer: ${booking.fullName}`,
    `Email: ${booking.email || "Not provided"}`,
    `Phone: ${booking.phone || "Not provided"}`,
    `WhatsApp: ${booking.whatsapp || "Not provided"}`,
    `Service: ${booking.service}${booking.serviceDetails ? ` — ${booking.serviceDetails}` : ""}`,
    `Requested date: ${booking.date || "Not specified"}`,
    `Preferred time: ${booking.preferredTime || "Not specified"}`,
    `Adults: ${booking.adults}`,
    `Children: ${booking.children}`,
    `Total guests: ${booking.guests}`,
    `Accommodation or pickup location: ${booking.location || "Not specified"}`,
    "",
    "Special requests / additional information:",
    booking.specialRequests || "None"
  ].join("\n");
}

function isMailConfigured(env) {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);
}

function hashAdminPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("Admin password must be at least 12 characters long.");
  }
  const digest = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function verifyAdminPassword(password, passwordHash) {
  if (typeof password !== "string" || typeof passwordHash !== "string") return false;
  const [, salt, expectedHex] = passwordHash.split("$");
  if (!salt || !/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{128}$/i.test(expectedHex || "")) {
    return false;
  }
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return crypto.timingSafeEqual(actual, expected);
}

function constantTimeEqual(first, second) {
  const firstBuffer = Buffer.from(String(first));
  const secondBuffer = Buffer.from(String(second));
  if (firstBuffer.length !== secondBuffer.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function getCookie(request, name) {
  const cookies = request.get("Cookie") || "";
  const cookie = cookies.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : "";
}

function createAdminSession(username, secret) {
  const payload = Buffer.from(JSON.stringify({
    username,
    expiresAt: Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyAdminSession(request, secret) {
  if (!secret || secret.length < 32) return null;
  const token = getCookie(request, ADMIN_SESSION_COOKIE);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof session.username !== "string" || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function createCustomerSession(customer, sessionId, expiresAt, secret) {
  const payload = Buffer.from(JSON.stringify({
    customerId: customer.id,
    sessionVersion: customer.session_version,
    sessionId,
    expiresAt
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyCustomerSession(request, secret, getCustomerById, getCustomerSessionById) {
  if (!secret || secret.length < 32) return null;
  const token = getCookie(request, CUSTOMER_SESSION_COOKIE);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isSafeInteger(session.customerId) ||
        !Number.isSafeInteger(session.sessionVersion) ||
        !Number.isSafeInteger(session.expiresAt) ||
        typeof session.sessionId !== "string" ||
        !/^[0-9a-f]{64}$/i.test(session.sessionId) ||
        session.expiresAt <= Date.now()) return null;
    const savedSession = getCustomerSessionById.get(session.sessionId);
    if (!savedSession ||
        savedSession.customer_id !== session.customerId ||
        savedSession.expires_at <= Date.now()) return null;
    const customer = getCustomerById.get(session.customerId);
    if (!customer || customer.session_version !== session.sessionVersion) return null;
    return { customer, sessionId: session.sessionId };
  } catch {
    return null;
  }
}

function serializeBooking(row) {
  return {
    reference: row.reference,
    ...JSON.parse(row.booking_json),
    createdAt: row.created_at,
    status: row.booking_status,
    businessEmailStatus: row.business_email_status,
    customerEmailStatus: row.customer_email_status,
    notificationAttempts: row.notification_attempts,
    customerNotificationAttempts: row.customer_notification_attempts,
    lastNotificationError: row.last_notification_error,
    lastCustomerNotificationError: row.last_customer_notification_error
  };
}

function ensureColumn(database, name, definition) {
  const columns = database.prepare("PRAGMA table_info(bookings)").all();
  if (!columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${definition}`);
  }
}

function createBookingApp(options = {}) {
  const env = options.env || process.env;
  const databasePath = options.databasePath ||
    (env.DATABASE_PATH ? path.resolve(ROOT, env.DATABASE_PATH) : path.join(ROOT, "data", "bookings.sqlite"));

  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      session_id TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      booking_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      business_email_status TEXT NOT NULL DEFAULT 'pending',
      customer_email_status TEXT NOT NULL DEFAULT 'pending',
      booking_status TEXT NOT NULL DEFAULT 'pending',
      notification_attempts INTEGER NOT NULL DEFAULT 0,
      last_notification_error TEXT,
      customer_notification_attempts INTEGER NOT NULL DEFAULT 0,
      last_customer_notification_error TEXT
    )
  `);
  ensureColumn(database, "booking_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(database, "notification_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "last_notification_error", "TEXT");
  ensureColumn(database, "customer_notification_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "last_customer_notification_error", "TEXT");
  if (!database.prepare("PRAGMA table_info(bookings)").all()
    .some((column) => column.name === "customer_id")) {
    database.exec("ALTER TABLE bookings ADD COLUMN customer_id INTEGER REFERENCES customers(id)");
  }
  database.exec("CREATE INDEX IF NOT EXISTS bookings_customer_id_idx ON bookings(customer_id, created_at DESC)");
  database.exec("CREATE INDEX IF NOT EXISTS password_reset_expiry_idx ON password_reset_tokens(expires_at)");
  database.exec("CREATE INDEX IF NOT EXISTS customer_sessions_expiry_idx ON customer_sessions(expires_at)");
  database.exec("CREATE INDEX IF NOT EXISTS bookings_created_at_idx ON bookings(created_at DESC)");
  database.exec("CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(booking_status)");

  const insertBooking = database.prepare(
    "INSERT INTO bookings (reference, idempotency_key, booking_json, created_at, customer_id) VALUES (?, ?, ?, ?, ?)"
  );
  const getBooking = database.prepare(
    "SELECT reference, booking_json, created_at, customer_id, booking_status, business_email_status, customer_email_status, notification_attempts, customer_notification_attempts, last_notification_error, last_customer_notification_error FROM bookings WHERE idempotency_key = ?"
  );
  const getBookingByReference = database.prepare(
    "SELECT reference, booking_json, created_at, customer_id, booking_status, business_email_status, customer_email_status, notification_attempts, customer_notification_attempts, last_notification_error, last_customer_notification_error FROM bookings WHERE reference = ?"
  );
  const updateBusinessStatus = database.prepare(
    "UPDATE bookings SET business_email_status = ?, notification_attempts = ?, last_notification_error = ? WHERE reference = ?"
  );
  const updateCustomerStatus = database.prepare(
    "UPDATE bookings SET customer_email_status = ?, customer_notification_attempts = ?, last_customer_notification_error = ? WHERE reference = ?"
  );
  const updateBookingStatus = database.prepare(
    "UPDATE bookings SET booking_status = ? WHERE reference = ?"
  );
  const mailer = options.mailer || (isMailConfigured(env)
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT),
        secure: env.SMTP_SECURE === "true",
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
      })
    : null);
  const sendBusinessNotification = async (saved, booking) => {
    const attempts = saved.notification_attempts + 1;
    updateBusinessStatus.run("pending", attempts, null, saved.reference);
    if (!mailer || !isMailConfigured(env) && !options.mailer) {
      updateBusinessStatus.run(
        "failed",
        attempts,
        "SMTP is not configured.",
        saved.reference
      );
      return false;
    }

    try {
      await mailer.sendMail({
        from: env.SMTP_FROM_EMAIL || env.SMTP_USER,
        to: BUSINESS_EMAIL,
        replyTo: booking.email || undefined,
        subject: `New booking request ${saved.reference}: ${booking.service}`,
        text: formatBooking(booking, saved.reference, saved.created_at)
      });
      updateBusinessStatus.run("sent", attempts, null, saved.reference);
      return true;
    } catch (error) {
      const code = typeof error.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(error.code)
        ? error.code
        : "EMAIL_DELIVERY_FAILED";
      console.error(`Business email delivery failed for ${saved.reference} (${code}).`);
      updateBusinessStatus.run("failed", attempts, code, saved.reference);
      return false;
    }
  };
  const sendCustomerConfirmation = async (saved, booking) => {
    if (!booking.email) {
      updateCustomerStatus.run(
        "skipped",
        saved.customer_notification_attempts,
        null,
        saved.reference
      );
      return true;
    }

    const attempts = saved.customer_notification_attempts + 1;
    updateCustomerStatus.run("pending", attempts, null, saved.reference);
    if (!mailer || !isMailConfigured(env) && !options.mailer) {
      updateCustomerStatus.run(
        "failed",
        attempts,
        "SMTP is not configured.",
        saved.reference
      );
      return false;
    }

    try {
      await mailer.sendMail({
        from: env.SMTP_FROM_EMAIL || env.SMTP_USER,
        to: booking.email,
        subject: `Booking request received — ${saved.reference}`,
        text: [
          `Hello ${booking.fullName},`,
          "",
          "We have received your booking request. It is awaiting confirmation from Brance Tours & Safaris; this email does not mean your booking is confirmed.",
          "",
          `Booking reference: ${saved.reference}`,
          `Service: ${booking.service}${booking.serviceDetails ? ` — ${booking.serviceDetails}` : ""}`,
          `Requested date: ${booking.date || "Not specified"}`,
          `Guests: ${booking.guests} (${booking.adults} adults, ${booking.children} children)`,
          "",
          "Our team will contact you to confirm availability and next steps.",
          "",
          "Brance Tours & Safaris"
        ].join("\n")
      });
      updateCustomerStatus.run("sent", attempts, null, saved.reference);
      return true;
    } catch (error) {
      const code = typeof error.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(error.code)
        ? error.code
        : "EMAIL_DELIVERY_FAILED";
      console.error(`Customer email delivery failed for ${saved.reference} (${code}).`);
      updateCustomerStatus.run("failed", attempts, code, saved.reference);
      return false;
    }
  };
  const app = express();
  const trustedProxyHops = Number.parseInt(env.TRUST_PROXY_HOPS, 10);
  if (Number.isInteger(trustedProxyHops) && trustedProxyHops > 0 && trustedProxyHops <= 5) {
    app.set("trust proxy", trustedProxyHops);
  }
  const activeRequests = new Map();
  const inFlight = new Map();
  const adminLoginAttempts = new Map();
  const customerAttempts = new Map();
  const adminPasswordHash = env.ADMIN_PASSWORD_HASH || "";
  const adminSessionSecret = env.ADMIN_SESSION_SECRET || "";
  const customerSessionSecret = env.CUSTOMER_SESSION_SECRET || "";
  const getCustomerById = database.prepare(
    "SELECT id, full_name, email, password_hash, session_version, created_at FROM customers WHERE id = ?"
  );
  const getCustomerByEmail = database.prepare(
    "SELECT id, full_name, email, password_hash, session_version, created_at FROM customers WHERE email = ? COLLATE NOCASE"
  );
  const getCustomerSessionById = database.prepare(
    "SELECT customer_id, expires_at FROM customer_sessions WHERE session_id = ?"
  );
  const insertCustomerSession = database.prepare(
    "INSERT INTO customer_sessions (session_id, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  );
  const deleteCustomerSession = database.prepare(
    "DELETE FROM customer_sessions WHERE session_id = ? AND customer_id = ?"
  );
  const insertCustomer = database.prepare(
    "INSERT INTO customers (full_name, email, password_hash, created_at) VALUES (?, ?, ?, ?)"
  );
  const createResetToken = database.prepare(
    "INSERT INTO password_reset_tokens (token_hash, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  );
  const deleteCustomerResetTokens = database.prepare(
    "DELETE FROM password_reset_tokens WHERE customer_id = ?"
  );
  const isCustomerAuthConfigured = customerSessionSecret.length >= 32;
  const dummyCustomerPasswordHash = hashAdminPassword("not-a-customer-account-password");
  const isAdminConfigured = Boolean(
    env.ADMIN_USERNAME &&
    adminPasswordHash &&
    adminSessionSecret.length >= 32
  );
  const allowedOrigins = (env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use((request, response, next) => {
    if (!/^\/api\/bookings\/?$/.test(request.path)) return next();

    const origin = request.get("Origin");
    let sameOrigin = false;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        sameOrigin =
          (originUrl.protocol === "http:" || originUrl.protocol === "https:") &&
          originUrl.host === request.get("host");
      } catch {
        sameOrigin = false;
      }
    }

    if (origin && !sameOrigin && !allowedOrigins.includes(origin)) {
      return response.status(403).json({ error: "This website is not allowed to submit bookings." });
    }

    if (origin && !sameOrigin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
      response.setHeader("Access-Control-Max-Age", "600");
    }

    if (request.method === "OPTIONS") {
      response.setHeader("Allow", "POST, OPTIONS");
      const requestedMethod = request.get("Access-Control-Request-Method");
      if (requestedMethod && requestedMethod !== "POST") {
        return response.status(405).json({
          error: `Method ${requestedMethod} is not allowed for the booking endpoint. Use POST.`
        });
      }
      return response.status(204).end();
    }

    next();
  });

  app.use(express.json({ limit: "16kb", strict: true }));

  const customerApiMethods = new Map([
    ["/signup", ["POST"]],
    ["/login", ["POST"]],
    ["/session", ["GET"]],
    ["/logout", ["POST"]],
    ["/forgot-password", ["POST"]],
    ["/reset-password", ["POST"]],
    ["/bookings", ["GET"]]
  ]);

  app.get("/api/health", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ status: "ok", service: "brance-booking-api" });
  });

  app.use("/api/customer", (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    const allowedMethods = customerApiMethods.get(request.path);
    if (allowedMethods && !allowedMethods.includes(request.method)) {
      response.setHeader("Allow", allowedMethods.join(", "));
      return response.status(405).json({
        error: `Method ${request.method} is not allowed for this customer endpoint. Use ${allowedMethods.join(" or ")}.`
      });
    }
    const origin = request.get("Origin");
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const sameOrigin =
          (originUrl.protocol === "http:" || originUrl.protocol === "https:") &&
          originUrl.host === request.get("host");
        if (!sameOrigin) {
          return response.status(403).json({ error: "Customer account actions must use the website origin." });
        }
      } catch {
        return response.status(403).json({ error: "Invalid request origin." });
      }
    }
    if (request.method === "OPTIONS") {
      response.setHeader("Allow", "GET, POST");
      return response.status(405).json({ error: "Cross-origin customer account requests are not supported." });
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        request.get("X-Customer-Action") !== "true") {
      return response.status(403).json({ error: "The customer account request could not be verified." });
    }
    return next();
  });

  const customerSession = (request) =>
    verifyCustomerSession(request, customerSessionSecret, getCustomerById, getCustomerSessionById);
  const customerProfile = (customer) => ({
    id: customer.id,
    fullName: customer.full_name,
    email: customer.email
  });
  const setCustomerCookie = (response, customer) => {
    database.prepare("DELETE FROM customer_sessions WHERE expires_at <= ?").run(Date.now());
    const sessionId = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + CUSTOMER_SESSION_TTL_SECONDS * 1000;
    insertCustomerSession.run(sessionId, customer.id, expiresAt, new Date().toISOString());
    const token = createCustomerSession(customer, sessionId, expiresAt, customerSessionSecret);
    const secureCookie = env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${CUSTOMER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${CUSTOMER_SESSION_TTL_SECONDS}${secureCookie}`
    );
  };
  const takeCustomerRateLimit = (key, limit) => {
    const now = Date.now();
    const previous = customerAttempts.get(key);
    const attempt = previous && now - previous.startedAt < RATE_WINDOW_MS
      ? previous
      : { startedAt: now, count: 0 };
    if (attempt.count >= limit) {
      return Math.ceil((RATE_WINDOW_MS - (now - attempt.startedAt)) / 1000);
    }
    attempt.count += 1;
    customerAttempts.set(key, attempt);
    if (customerAttempts.size > 5000) {
      for (const [attemptKey, entry] of customerAttempts) {
        if (now - entry.startedAt >= RATE_WINDOW_MS) customerAttempts.delete(attemptKey);
      }
    }
    return 0;
  };
  const customerAuthNotConfigured = (response) => {
    if (isCustomerAuthConfigured) return false;
    response.status(503).json({ error: "Customer sign-in is not configured on the server." });
    return true;
  };

  app.post("/api/customer/signup", (request, response) => {
    if (customerAuthNotConfigured(response)) return;
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const retryAfter = takeCustomerRateLimit(`signup:${address}`, 10);
    if (retryAfter) {
      response.setHeader("Retry-After", String(retryAfter));
      return response.status(429).json({ error: "Too many registration attempts. Please try again later." });
    }

    const fullName = cleanString(request.body?.fullName, 120);
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;
    if (!fullName || fullName.length < 2) {
      return response.status(400).json({ error: "Enter your full name (at least 2 characters)." });
    }
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.status(400).json({ error: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      return response.status(400).json({ error: "Choose a password between 12 and 256 characters." });
    }
    if (getCustomerByEmail.get(email)) {
      return response.status(409).json({ error: "An account with this email already exists. Please log in instead." });
    }

    let customerId;
    try {
      customerId = Number(insertCustomer.run(
        fullName,
        email,
        hashAdminPassword(password),
        new Date().toISOString()
      ).lastInsertRowid);
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") {
        return response.status(409).json({ error: "An account with this email already exists. Please log in instead." });
      }
      throw error;
    }
    const customer = getCustomerById.get(customerId);
    setCustomerCookie(response, customer);
    return response.status(201).json({
      authenticated: true,
      customer: customerProfile(customer)
    });
  });

  app.post("/api/customer/login", (request, response) => {
    if (customerAuthNotConfigured(response)) return;
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const retryAfter = takeCustomerRateLimit(`login:${address}`, 10);
    if (retryAfter) {
      response.setHeader("Retry-After", String(retryAfter));
      return response.status(429).json({ error: "Too many sign-in attempts. Please try again later." });
    }

    const email = normalizeEmail(request.body?.email);
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const customer = email.length <= 254 ? getCustomerByEmail.get(email) : null;
    const passwordMatches = verifyAdminPassword(
      password.length <= 256 ? password : "",
      customer ? customer.password_hash : dummyCustomerPasswordHash
    );
    if (!customer || !passwordMatches) {
      return response.status(401).json({ error: "The email or password is incorrect." });
    }

    customerAttempts.delete(`login:${address}`);
    setCustomerCookie(response, customer);
    return response.status(200).json({
      authenticated: true,
      customer: customerProfile(customer)
    });
  });

  app.get("/api/customer/session", (request, response) => {
    const session = isCustomerAuthConfigured ? customerSession(request) : null;
    const customer = session?.customer || null;
    return response.status(200).json({
      authenticated: Boolean(customer),
      customer: customer ? customerProfile(customer) : null
    });
  });

  app.post("/api/customer/logout", (request, response) => {
    const session = isCustomerAuthConfigured ? customerSession(request) : null;
    if (session) {
      deleteCustomerSession.run(session.sessionId, session.customer.id);
    }
    const secureCookie = env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${CUSTOMER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie}`
    );
    return response.status(200).json({ authenticated: false });
  });

  app.post("/api/customer/forgot-password", async (request, response) => {
    if (customerAuthNotConfigured(response)) return;
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const retryAfter = takeCustomerRateLimit(`forgot:${address}`, 5);
    if (retryAfter) {
      response.setHeader("Retry-After", String(retryAfter));
      return response.status(429).json({ error: "Too many reset requests. Please try again later." });
    }

    const email = normalizeEmail(request.body?.email);
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.status(400).json({ error: "Enter a valid email address." });
    }
    const genericMessage = "If an account exists for that email, password reset instructions will be sent shortly.";
    const customer = getCustomerByEmail.get(email);
    if (!customer) return response.status(200).json({ message: genericMessage });

    const siteUrl = env.PUBLIC_SITE_URL;
    let resetPage;
    try {
      const parsedSiteUrl = new URL(siteUrl);
      if (!["https:", "http:"].includes(parsedSiteUrl.protocol) ||
          (env.NODE_ENV === "production" && parsedSiteUrl.protocol !== "https:")) {
        throw new Error("Invalid public site URL.");
      }
      resetPage = new URL("/reset-password.html", parsedSiteUrl);
    } catch {
      console.error("Password reset email unavailable (PUBLIC_SITE_URL_NOT_CONFIGURED).");
      return response.status(200).json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const createdAt = new Date().toISOString();
    deleteCustomerResetTokens.run(customer.id);
    createResetToken.run(tokenHash, customer.id, Date.now() + PASSWORD_RESET_TTL_MS, createdAt);
    resetPage.searchParams.set("token", rawToken);

    if (!mailer || !isMailConfigured(env) && !options.mailer) {
      deleteCustomerResetTokens.run(customer.id);
      console.error("Password reset email unavailable (SMTP_NOT_CONFIGURED).");
      return response.status(200).json({ message: genericMessage });
    }
    try {
      await mailer.sendMail({
        from: env.SMTP_FROM_EMAIL || env.SMTP_USER,
        to: customer.email,
        subject: "Reset your Brance Tours & Safaris password",
        text: [
          `Hello ${customer.full_name},`,
          "",
          "Use the link below to choose a new password. This link expires in 30 minutes and can only be used once.",
          "",
          resetPage.toString(),
          "",
          "If you did not request this, you can ignore this email."
        ].join("\n")
      });
    } catch (error) {
      deleteCustomerResetTokens.run(customer.id);
      const code = typeof error.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(error.code)
        ? error.code
        : "EMAIL_DELIVERY_FAILED";
      console.error(`Password reset email delivery failed (${code}).`);
    }
    return response.status(200).json({ message: genericMessage });
  });

  app.post("/api/customer/reset-password", (request, response) => {
    if (customerAuthNotConfigured(response)) return;
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const retryAfter = takeCustomerRateLimit(`reset:${address}`, 10);
    if (retryAfter) {
      response.setHeader("Retry-After", String(retryAfter));
      return response.status(429).json({ error: "Too many password reset attempts. Please try again later." });
    }
    const token = request.body?.token;
    const password = request.body?.password;
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) {
      return response.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      return response.status(400).json({ error: "Choose a password between 12 and 256 characters." });
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const reset = database.prepare(
      "SELECT customer_id, expires_at FROM password_reset_tokens WHERE token_hash = ?"
    ).get(tokenHash);
    if (!reset || reset.expires_at <= Date.now()) {
      return response.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const activeReset = database.prepare(
        "SELECT customer_id, expires_at FROM password_reset_tokens WHERE token_hash = ?"
      ).get(tokenHash);
      if (!activeReset || activeReset.expires_at <= Date.now()) {
        database.exec("ROLLBACK");
        return response.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });
      }
      database.prepare(
        "UPDATE customers SET password_hash = ?, session_version = session_version + 1 WHERE id = ?"
      ).run(hashAdminPassword(password), activeReset.customer_id);
      deleteCustomerResetTokens.run(activeReset.customer_id);
      database.prepare("DELETE FROM customer_sessions WHERE customer_id = ?")
        .run(activeReset.customer_id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return response.status(200).json({ message: "Your password has been updated. Please log in with your new password." });
  });

  app.get("/api/customer/bookings", (request, response) => {
    if (!isCustomerAuthConfigured) {
      return response.status(503).json({ error: "Customer sign-in is not configured on the server." });
    }
    const session = customerSession(request);
    if (!session) return response.status(401).json({ error: "Sign in to view your bookings." });
    const bookings = database.prepare(
      "SELECT reference, booking_json, created_at, booking_status FROM bookings WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100"
    ).all(session.customer.id).map((row) => ({
      reference: row.reference,
      ...JSON.parse(row.booking_json),
      createdAt: row.created_at,
      status: row.booking_status
    }));
    return response.status(200).json({ bookings });
  });

  app.post("/api/bookings", async (request, response) => {
    const now = Date.now();
    const clientAddress = request.ip || request.socket.remoteAddress || "unknown";
    const previous = activeRequests.get(clientAddress);
    const recent = previous && now - previous.startedAt < RATE_WINDOW_MS ? previous : { startedAt: now, count: 0 };

    if (recent.count >= MAX_REQUESTS) {
      response.setHeader("Retry-After", String(Math.ceil((RATE_WINDOW_MS - (now - recent.startedAt)) / 1000)));
      return response.status(429).json({ error: "Too many booking requests. Please try again later." });
    }
    recent.count += 1;
    activeRequests.set(clientAddress, recent);
    if (activeRequests.size > 5000) {
      for (const [address, entry] of activeRequests) {
        if (now - entry.startedAt >= RATE_WINDOW_MS) activeRequests.delete(address);
      }
    }

    const idempotencyKey = request.get("Idempotency-Key");
    if (typeof idempotencyKey !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return response.status(400).json({ error: "Please refresh the page and try submitting again." });
    }

    const result = validateBooking(request.body);
    if (result.error) return response.status(400).json({ error: result.error });

    const booking = result.booking;
    let saved = getBooking.get(idempotencyKey);
    if (!saved) {
      const reference = `BTS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const submittedAt = new Date().toISOString();
      try {
        const session = isCustomerAuthConfigured ? customerSession(request) : null;
        insertBooking.run(
          reference,
          idempotencyKey,
          JSON.stringify(booking),
          submittedAt,
          session?.customer.id || null
        );
      } catch (error) {
        if (error.code !== "ERR_SQLITE_CONSTRAINT_UNIQUE") throw error;
      }
      saved = getBooking.get(idempotencyKey);
    }

    if (JSON.stringify(JSON.parse(saved.booking_json)) !== JSON.stringify(booking)) {
      return response.status(409).json({
        error: "This request key was already used for different booking details. Please refresh the page and submit again."
      });
    }

    if (inFlight.has(idempotencyKey)) {
      const pending = await inFlight.get(idempotencyKey);
      return response.status(pending.status).json(pending.body);
    }

    const savedBooking = JSON.parse(saved.booking_json);
    const operation = (async () => {
      const businessDelivered = saved.business_email_status === "sent" ||
        await sendBusinessNotification(saved, savedBooking);
      if (!businessDelivered) {
        return {
          status: 503,
          body: {
            error: "Your booking was saved, but we could not send your booking notification. Please contact us or try again shortly.",
            bookingReference: saved.reference,
            bookingStatus: saved.booking_status,
            businessEmailStatus: "failed"
          }
        };
      }

      const refreshed = getBooking.get(idempotencyKey);
      const customerDelivered = refreshed.customer_email_status === "sent" ||
        await sendCustomerConfirmation(refreshed, savedBooking);
      const confirmationNotice = !customerDelivered
        ? " The business received your request, but we could not deliver the email confirmation. It will need a retry."
        : "";
      return {
        status: 201,
        body: {
          bookingReference: saved.reference,
          bookingStatus: saved.booking_status,
          businessEmailStatus: "sent",
          customerEmailStatus: savedBooking.email
            ? customerDelivered ? "sent" : "failed"
            : "skipped",
          message: `Your booking request has been received and sent to Brance Tours & Safaris. It is awaiting confirmation; it is not yet confirmed.${confirmationNotice}`
        }
      };
    })();

    inFlight.set(idempotencyKey, operation);
    try {
      const outcome = await operation;
      return response.status(outcome.status).json(outcome.body);
    } finally {
      inFlight.delete(idempotencyKey);
    }
  });

  app.use("/api/admin", (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    const origin = request.get("Origin");
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const sameOrigin =
          (originUrl.protocol === "http:" || originUrl.protocol === "https:") &&
          originUrl.host === request.get("host");
        if (!sameOrigin) {
          return response.status(403).json({ error: "Administrator actions must use the website origin." });
        }
      } catch {
        return response.status(403).json({ error: "Invalid request origin." });
      }
    }

    if (request.method === "OPTIONS") {
      response.setHeader("Allow", "GET, POST, PUT");
      return response.status(405).json({ error: "Cross-origin administrator requests are not supported." });
    }
    next();
  });

  app.post("/api/admin/login", (request, response) => {
    const now = Date.now();
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const previous = adminLoginAttempts.get(address);
    const attempt = previous && now - previous.startedAt < RATE_WINDOW_MS
      ? previous
      : { startedAt: now, count: 0 };
    if (attempt.count >= 5) {
      response.setHeader("Retry-After", String(Math.ceil((RATE_WINDOW_MS - (now - attempt.startedAt)) / 1000)));
      return response.status(429).json({ error: "Too many sign-in attempts. Try again later." });
    }
    attempt.count += 1;
    adminLoginAttempts.set(address, attempt);

    if (!isAdminConfigured) {
      return response.status(503).json({ error: "Administrator access has not been configured on the server." });
    }

    const username = typeof request.body?.username === "string" ? request.body.username : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const usernameMatches = constantTimeEqual(username, env.ADMIN_USERNAME);
    const passwordMatches = password.length <= 256 &&
      verifyAdminPassword(password, adminPasswordHash);

    if (!usernameMatches || !passwordMatches) {
      return response.status(401).json({ error: "The username or password is incorrect." });
    }

    adminLoginAttempts.delete(address);
    const session = createAdminSession(env.ADMIN_USERNAME, adminSessionSecret);
    const secureCookie = env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${ADMIN_SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL_SECONDS}${secureCookie}`
    );
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ authenticated: true, username: env.ADMIN_USERNAME });
  });

  app.get("/api/admin/session", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const session = verifyAdminSession(request, adminSessionSecret);
    return response.status(200).json({
      authenticated: Boolean(session && isAdminConfigured),
      username: session && isAdminConfigured ? session.username : null
    });
  });

  const requireAdmin = (request, response, next) => {
    const session = verifyAdminSession(request, adminSessionSecret);
    if (!session || !isAdminConfigured || !constantTimeEqual(session.username, env.ADMIN_USERNAME)) {
      return response.status(401).json({ error: "Sign in to access bookings." });
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        request.get("X-Admin-Action") !== "true") {
      return response.status(403).json({ error: "The administrator request could not be verified." });
    }
    request.admin = session;
    return next();
  };

  app.post("/api/admin/logout", requireAdmin, (request, response) => {
    const secureCookie = env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie}`
    );
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ authenticated: false });
  });

  app.get("/api/admin/bookings", requireAdmin, (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100) : "";
    const status = typeof request.query.status === "string" ? request.query.status : "";
    const dateFrom = typeof request.query.dateFrom === "string" ? request.query.dateFrom : "";
    const dateTo = typeof request.query.dateTo === "string" ? request.query.dateTo : "";
    const limit = Number.parseInt(request.query.limit, 10) || 50;
    const offset = Number.parseInt(request.query.offset, 10) || 0;

    if (status && !BOOKING_STATUSES.has(status)) {
      return response.status(400).json({ error: "Choose a valid booking status filter." });
    }
    if ((dateFrom && !isValidDate(dateFrom)) || (dateTo && !isValidDate(dateTo))) {
      return response.status(400).json({ error: "Enter valid booking dates for the filter." });
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return response.status(400).json({ error: "The start date must be on or before the end date." });
    }

    const conditions = [];
    const parameters = [];
    if (status) {
      conditions.push("booking_status = ?");
      parameters.push(status);
    }
    if (dateFrom) {
      conditions.push("json_extract(booking_json, '$.date') >= ?");
      parameters.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("json_extract(booking_json, '$.date') <= ?");
      parameters.push(dateTo);
    }
    if (query) {
      const escaped = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push("(reference LIKE ? ESCAPE '\\' OR json_extract(booking_json, '$.fullName') LIKE ? ESCAPE '\\' OR json_extract(booking_json, '$.email') LIKE ? ESCAPE '\\' OR json_extract(booking_json, '$.phone') LIKE ? ESCAPE '\\' OR json_extract(booking_json, '$.whatsapp') LIKE ? ESCAPE '\\' OR json_extract(booking_json, '$.service') LIKE ? ESCAPE '\\')");
      parameters.push(escaped, escaped, escaped, escaped, escaped, escaped);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = database.prepare(
      `SELECT COUNT(*) AS total FROM bookings ${where}`
    ).get(...parameters).total;
    const bookings = database.prepare(
      `SELECT reference, booking_json, created_at, booking_status, business_email_status, customer_email_status, notification_attempts, customer_notification_attempts, last_notification_error, last_customer_notification_error FROM bookings ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...parameters, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));

    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      bookings: bookings.map(serializeBooking),
      total,
      limit: Math.min(Math.max(limit, 1), 100),
      offset: Math.max(offset, 0)
    });
  });

  app.get("/api/admin/bookings/:reference", requireAdmin, (request, response) => {
    const booking = getBookingByReference.get(request.params.reference);
    if (!booking) return response.status(404).json({ error: "Booking not found." });
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ booking: serializeBooking(booking) });
  });

  app.put("/api/admin/bookings/:reference/status", requireAdmin, (request, response) => {
    const status = request.body?.status;
    if (typeof status !== "string" || !BOOKING_STATUSES.has(status)) {
      return response.status(400).json({ error: "Choose pending, confirmed, cancelled or completed." });
    }
    const existing = getBookingByReference.get(request.params.reference);
    if (!existing) return response.status(404).json({ error: "Booking not found." });
    updateBookingStatus.run(status, request.params.reference);
    return response.status(200).json({
      reference: request.params.reference,
      status
    });
  });

  app.post("/api/admin/bookings/:reference/retry-email", requireAdmin, async (request, response) => {
    const reference = request.params.reference;
    const saved = getBookingByReference.get(reference);
    if (!saved) return response.status(404).json({ error: "Booking not found." });
    if (!["failed", "pending"].includes(saved.business_email_status) &&
        !["failed", "pending"].includes(saved.customer_email_status)) {
      return response.status(409).json({ error: "This booking has no failed email notifications to retry." });
    }

    const retryKey = `email-retry:${reference}`;
    if (inFlight.has(retryKey)) {
      return response.status(409).json({ error: "Email retry is already in progress for this booking." });
    }

    const operation = (async () => {
      const booking = JSON.parse(saved.booking_json);
      if (["failed", "pending"].includes(saved.business_email_status)) {
        await sendBusinessNotification(saved, booking);
      }
      const refreshed = getBookingByReference.get(reference);
      if (booking.email &&
          ["failed", "pending"].includes(refreshed.customer_email_status)) {
        await sendCustomerConfirmation(refreshed, booking);
      }
      return getBookingByReference.get(reference);
    })();

    inFlight.set(retryKey, operation);
    try {
      const refreshed = await operation;
      const result = serializeBooking(refreshed);
      const deliveryFailed = refreshed.business_email_status !== "sent" ||
        (JSON.parse(refreshed.booking_json).email && refreshed.customer_email_status !== "sent");
      response.setHeader("Cache-Control", "no-store");
      return response.status(deliveryFailed ? 503 : 200).json({
        booking: result,
        message: deliveryFailed
          ? "One or more email notifications still failed. The booking remains saved."
          : "Failed email notifications were delivered."
      });
    } finally {
      inFlight.delete(retryKey);
    }
  });

  app.use("/api/bookings", (request, response) => {
    response.setHeader("Allow", "POST, OPTIONS");
    response.setHeader("Cache-Control", "no-store");
    return response.status(405).json({
      error: `Method ${request.method} is not allowed for the booking endpoint. Use POST.`
    });
  });

  app.use("/api", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    return response.status(404).json({
      error: `Booking API route not found: ${request.method} ${request.path}.`
    });
  });

  app.use((request, response, next) => {
    const pathname = decodeURIComponent(request.path);
    if (/^\/(?:server\.js|server\.test\.js|package(?:-lock)?\.json|\.env(?:\.example)?)(?:\/|$)/i.test(pathname) ||
        /^\/(?:data|node_modules|scripts|tests|\.git)(?:\/|$)/i.test(pathname)) {
      return response.sendStatus(404);
    }
    if (/\.sqlite(?:-shm|-wal)?$/i.test(pathname)) return response.sendStatus(404);
    next();
  });
  app.use(express.static(ROOT, { dotfiles: "deny", index: "index.html" }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    response.setHeader("Cache-Control", "no-store");
    if (error.type === "entity.unsupported") {
      return response.status(415).json({ error: "The booking request must use JSON." });
    }
    if (error.type === "entity.parse.failed") {
      return response.status(400).json({ error: "The booking request was not valid JSON." });
    }
    if (error.type === "entity.too.large") {
      return response.status(413).json({ error: "The booking request is too large." });
    }
    console.error("Booking server error:", error.message);
    return response.status(500).json({ error: "Something went wrong. Please try again or contact us directly." });
  });

  return { app, database };
}

if (require.main === module) {
  const { app } = createBookingApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Brance Tours & Safaris website is available at http://localhost:${port}`);
    if (!isMailConfigured(process.env)) {
      console.warn("SMTP is not configured. Booking submissions will be saved but email cannot be delivered.");
    }
  });
}

module.exports = {
  BUSINESS_EMAIL,
  SERVICES,
  createBookingApp,
  hashAdminPassword,
  validateBooking,
  verifyAdminPassword
};
