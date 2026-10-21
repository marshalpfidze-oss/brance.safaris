# Brance Tours & Safaris

The website uses a Node.js backend to validate and save booking requests in SQLite, send the business notification to `brancetoursandsafaris@gmail.com`, and email the customer a receipt when they provide an address. A received request remains pending until Brance Tours & Safaris confirms it.

## Requirements

- Node.js 22.13 or later
- Gmail SMTP credentials configured as a Google App Password, or another SMTP service

## Install and configure

From this project folder:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM_EMAIL`. For Gmail, use `smtp.gmail.com`, port `465`, and `SMTP_SECURE=true`. Set `SMTP_USER` and `SMTP_FROM_EMAIL` to the Gmail account that will send the messages. `SMTP_PASS` must be a Google App Password, not the normal Google account password. Remove spaces when copying the App Password into `.env`.

Set `PUBLIC_SITE_URL` to the public HTTPS website URL (for example, `https://www.example.com`) so password-reset emails point to the correct site. Generate a private `CUSTOMER_SESSION_SECRET` with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and keep it in the server environment only. Customer accounts use the existing SQLite database, scrypt password hashes, and signed HttpOnly cookies. No extra authentication provider or dependency is required.

To create an App Password, enable 2-Step Verification for the Google account, then open the Google Account Security settings and create an App Password for this website. Google may not offer App Passwords for some managed or Advanced Protection accounts. Keep `.env` private; it is excluded from Git.

## Run

```powershell
npm start
```

Open `http://localhost:3000`. Booking data is stored in `data/bookings.sqlite` by default; set `DATABASE_PATH` to a persistent location if needed. Do not place the database in a publicly served directory. Do not use a static-only host such as GitHub Pages for deployment: the Node server and persistent disk must remain available, and production traffic should use HTTPS.

## Deploy the booking endpoint

The form submits `POST` to the URL in the `bookingForm` form's `action` attribute in `index.html` (locally, `/api/bookings`). Deploy this Node.js application, including `server.js`, `package.json`, `package-lock.json`, `app.js`, `customer.js`, `index.html`, `login.html`, `signup.html`, `dashboard.html`, `reset-password.html`, and the website assets, to a host that runs the Node server and preserves its `DATABASE_PATH` storage. The Node host's start command is `npm start`.

For a single-origin deployment, serve the website and `/api/*` from that Node application so the existing relative customer API URLs and `/api/bookings` action resolve on the correct host. Include `admin.html`, `admin.js`, and `admin.css` in the deployment. Check `https://your-website.example.com/api/health` after deployment; the Node API returns `{"status":"ok","service":"brance-booking-api"}`. If the request returns a host-generated 404/405 or HTML page, the frontend host is not routing API requests to this Node service. Configure the hosting rewrite/reverse proxy to send `/api/*` to the Node server, or serve both frontend and backend from this application. No hosting provider or proxy configuration was present in this project, so that live rewrite must be set on the actual provider. Customer login and registration use same-origin HttpOnly cookies; keep account pages and `/api/customer/*` on one origin rather than placing them on a separate static host. For a separate booking-only frontend, set the form's `action` to the backend's HTTPS URL and configure `CORS_ORIGIN` to the exact frontend origin. Do not use `*`.

SQLite requires a durable writable disk on the Node host. Set `DATABASE_PATH` to that mounted path and back it up; ephemeral serverless filesystems are not suitable for permanent bookings. If the app is behind a known number of trusted reverse proxies, configure `TRUST_PROXY_HOPS` to that exact number so rate limiting can identify client addresses correctly; leave it unset otherwise. No hosting provider or static-site-to-backend proxy configuration was present in this project, so the actual live platform and deployment must be verified/configured at the host.

If SMTP is not configured or delivery fails, the booking remains saved and the failed notification status, attempt count, and safe error code are recorded. The form reports a business notification failure instead of claiming it was delivered. Retrying the same request reuses its idempotency key. An authenticated staff member can also retry failed business or customer email from the dashboard without re-sending an already delivered notification.

## Customer accounts

Customers can create an account at `/signup.html`, sign in at `/login.html`, and review their own booking requests at `/dashboard.html`. Customer booking records are linked by the server-side session when a signed-in customer submits the existing booking form. Previous guest bookings are not automatically assigned to a new account. Booking status remains pending until authorized staff confirm it.

Password reset is available from the login page. It sends a single-use, 30-minute reset link through the configured SMTP service. The reset flow returns a generic response whether or not an email is registered, and successful password changes invalidate all existing customer sessions. Signing out revokes the current session. Customer account writes are same-origin protected and rate-limited. Passwords are never returned by the API or stored in plaintext. Configure `CUSTOMER_SESSION_SECRET`, `PUBLIC_SITE_URL`, SMTP, and durable `DATABASE_PATH` storage before enabling accounts in production. Use HTTPS in production; cookies are HttpOnly, SameSite=Strict, and Secure when `NODE_ENV=production`.

## Administrator access

The staff dashboard is available at `/admin.html`. Staff access has no public registration or password-reset route. Configure one staff account using `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_SECRET` in the private server environment:

1. Run `npm run admin:hash` in a terminal, enter a password of at least 12 characters (input is hidden), and copy the printed `ADMIN_PASSWORD_HASH` value into `.env`.
2. Set `ADMIN_USERNAME` to the staff login name.
3. Generate a session-signing secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and assign it to `ADMIN_SESSION_SECRET`.
4. Set `NODE_ENV=production` on the HTTPS production server so the administrator session cookie has the `Secure` flag.

The admin API enforces authentication server-side. Passwords are scrypt-hashed, sessions are signed, HttpOnly, SameSite=Strict cookies with an eight-hour lifetime, write requests require a same-origin check and custom action header, and login attempts are rate-limited. Do not put admin credentials or session secrets in frontend files. Keep `/admin.html` on the same origin as the API so the secure session cookie is sent.

Staff can search/filter bookings, inspect customer and notification details, change status to pending, confirmed, cancelled, or completed, and retry failed notifications. A booking request is not marked confirmed unless staff explicitly changes its status.

## Test

```powershell
npm test
```

The automated tests use a mock SMTP transport and an in-memory SQLite database; they do not send real emails. They cover booking validation and persistence, failed delivery/retry, customer registration/login/session/reset and booking ownership, administrator authentication and authorization, status updates, CORS, invalid methods, account-page assets, and the API health check. To verify real delivery, configure `.env`, run the server, and submit a test booking through the website. Confirm the business notification and customer receipt arrive, then have an authorized staff member confirm the booking separately.
