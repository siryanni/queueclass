# QueueClass

A minimal, real-time classroom queue for student questions during independent work sessions.

**Open. Add. Wait. Learn.**

## Stack

- Vanilla HTML, CSS and JavaScript
- Supabase (PostgreSQL, Realtime, Edge Functions)
- Static hosting (e.g. Vercel or Netlify)

No frontend build step is required.

## Features

- Add a question with initials
- Server-generated timestamps
- Chronological shared queue (FIFO)
- Live updates across connected devices
- Remove only your own message using a private owner token
- Start and end a lesson session
- Messages are deleted when a session ends

## 1. Create a Supabase project

Create a project at https://supabase.com/dashboard. Choose an EU region (Frankfurt if available).

In **Project Settings → API**, copy:
- Project URL
- Publishable key (or legacy anon key)

Put both values in `js/config.js`.

Never put the `service_role` key in frontend files.

## 2. Create the database

Open **SQL Editor** in Supabase and run the complete contents of `supabase/schema.sql`.

This creates:
- `lessons`
- `messages`
- `message_owners` (private table)
- read-only RLS policies for browser clients
- Realtime publication entries

## 3. Deploy Edge Functions

Install the Supabase CLI, log in, link this project, then deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-message --no-verify-jwt
supabase functions deploy delete-message --no-verify-jwt
supabase functions deploy manage-session --no-verify-jwt
```

The functions use the project's server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables. Supabase provides these to Edge Functions.

`supabase/config.toml` also sets `verify_jwt = false`, because this prototype intentionally has no user accounts. The functions validate their inputs and use server-side service credentials. This is a trust-based classroom prototype, not an identity system.

## 4. Run locally

Because the app uses browser modules/CDN resources, serve the folder over HTTP rather than opening `index.html` as a file.

For example:

```bash
python -m http.server 8080
```

Then open http://localhost:8080.

## 5. Deploy the frontend

Deploy the repository as a static site on Vercel or Netlify. The publishable Supabase key is intended to be public. Do not expose the service-role key.

## Important operating model

There are no accounts or teacher roles. Anyone with the class link can start or end a session. This is intentional for the first trusted-classroom version, but it means students must agree not to misuse those controls. If this is later used beyond a trusted class, session start/end should be protected by a teacher PIN or authenticated role.

A session expires after three hours in the database. The UI also provides an explicit **Stunde beenden** action, which deletes the session's messages immediately. Expired sessions are hidden from clients by RLS. For physical cleanup of expired session rows, schedule `public.cleanup_expired_queueclass_sessions()` with Supabase Cron if available.

## Security notes

- The frontend only has the publishable/anon key.
- Browser clients can read active sessions and their messages.
- Browser clients cannot directly insert, update or delete database rows.
- Message creation and deletion happen through Edge Functions.
- Each created message receives a random owner token. Only its SHA-256 hash is stored in the private `message_owners` table.
- The owner token is stored in that browser's local storage so the author can remove their own message later.
- There is no real identity verification. Clearing browser storage loses the ability to remove that browser's message; the class can end the session to clear all messages.

## MVP limitations / before real classroom use

- No user accounts or reliable identity verification.
- Session controls are open to anyone with the link.
- No robust per-IP rate limiting.
- The owner token is stored in local storage on the device that created the message.
- Google Fonts and Supabase JS are loaded from CDNs.
- The application should be tested with multiple devices and browsers before classroom use.

## License

MIT. See `LICENSE`.
