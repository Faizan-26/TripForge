# Supabase email OTP setup

The application uses the official `@supabase/ssr` cookie-based session flow. The publishable key is intentionally available to the browser; never add a service-role or secret key to `NEXT_PUBLIC_*` variables.

## Required dashboard configuration

1. Open **Authentication → Email Templates → Magic Link**.
2. Replace the link-oriented body with an OTP-oriented message that includes the token:

   ```html
   <h2>Your TripForge sign-in code</h2>
   <p>Enter this code to continue:</p>
   <p style="font-size: 28px; font-weight: 700; letter-spacing: 8px;">{{ .Token }}</p>
   <p>This code expires shortly. If you did not request it, ignore this email.</p>
   ```

3. In **Authentication → URL Configuration**, set:

   - Development Site URL: `http://localhost:3000`
   - Production Site URL: the deployed HTTPS origin

4. Keep email sign-up enabled if first-time travelers should be created automatically.
5. Before production, configure custom SMTP, review email OTP expiry/rate limits, and enable CAPTCHA if abuse appears.

## Local environment

Copy `.env.example` to `.env.local` and fill in the project values. `.env.local` is ignored by Git.

## Implemented flow

```text
Landing trip request
  → sessionStorage trip draft
  → email OTP request
  → /auth/verify
  → verify six-digit OTP
  → cookie-backed Supabase session
  → protected /chat/new
```

The trip draft remains in the browser until a future conversation-creation request succeeds. Do not clear it merely because authentication succeeded.

## Production checks

- New email receives a six-digit code and creates a user.
- Existing email signs in without creating a duplicate user.
- Invalid and expired codes show a recoverable error.
- Resend stays disabled for 60 seconds.
- Opening `/chat/new` while signed out redirects to `/?auth=required`.
- An authenticated landing submission bypasses OTP and opens `/chat/new`.
- Sign-out removes the session and returns to `/`.
