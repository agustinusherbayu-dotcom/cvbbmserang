# CV Banten Bangkit Maju (BBM)

This project is a responsive internal company management application for BBM. It uses Express.js, Neon PostgreSQL, Cloudflare R2 private object storage, PostgreSQL-backed sessions, and a mobile-friendly frontend.

## Features

- Secure login with phone number and 6-digit PIN
- Password hashing with bcryptjs
- Four roles: Direktur (admin), Manager, Komisaris, and Karyawan
- Only Direktur/admin can create accounts or change roles; Manager, Komisaris, and Karyawan cannot access user administration
- Manager, Komisaris, and Karyawan can only access tasks assigned to their own account and their personal bonus summaries; finance, documents, audit, and user administration are Direktur-only
- Direktur assigns tasks to active Karyawan accounts; employees submit progress notes and results, with each update retained in task history for review
- Employee dashboards show personal task counts and progress, without company cash, transaction, or financial summary data
- Completed tasks are submitted for Direktur review before they can be approved
- Transaction input for finance management
- Task tracking and verification workflow
- Audit logging for authentication and operational activity
- PWA support for installation on desktop and mobile devices
- Persistent Neon PostgreSQL database
- Optional private Cloudflare R2 storage for documents and transaction attachments
- PostgreSQL-backed sessions suitable for serverless instances

## Initial Direktur account

The app does not create demo users or sample business records. On an empty Neon database, set these environment variables to create the first Direktur account:

- `BBM_ADMIN_PHONE`: initial account phone number
- `BBM_ADMIN_PIN`: initial 6-digit PIN
- `BBM_ADMIN_NAME`: optional display name (defaults to `Direktur`)

After startup, the first Direktur can create employee, Manager, and Komisaris accounts from the Pengguna menu.

## Environment variables

Configure these for local development and in Vercel Project Settings > Environment Variables:

- `DATABASE_URL`: Neon PostgreSQL pooled connection string (with SSL enabled)
- `SESSION_SECRET`: long random secret used to sign sessions
- `BBM_ADMIN_PHONE`: initial Direktur phone number; only used when the users table is empty
- `BBM_ADMIN_PIN`: initial 6-digit PIN; only used when the users table is empty
- `BBM_ADMIN_NAME`: optional initial Direktur name
- `R2_ACCOUNT_ID`: Cloudflare account ID (optional)
- `R2_ACCESS_KEY_ID`: R2 API token access key (optional)
- `R2_SECRET_ACCESS_KEY`: R2 API token secret (optional)
- `R2_BUCKET_NAME`: private R2 bucket name (optional)
- `R2_ENDPOINT`: optional custom S3 endpoint; defaults to the account's Cloudflare R2 endpoint

If you configure R2, create the bucket without public access and use an API token limited to that bucket. Documents are stored under private object keys and only served through 60-second signed downloads after the app checks the Direktur session. Without R2, the app works for other workflows and explicitly disables file attachments in the UI.

## Run locally

```bash
npm install
npm start
```

Set the environment variables above before starting. The schema is initialized automatically. Open http://localhost:3000.

## Deploy to Vercel

The root `server.js` exports the Express app for Vercel's zero-configuration Express support; `vercel.json` includes the static frontend assets. Create the Neon database and private R2 bucket, set all required environment variables in Vercel, then deploy. Vercel's filesystem is not used for application data. Document and transaction attachments are limited to 3 MB to leave room for multipart request overhead under Vercel's serverless payload limit. The login attempt limit is stored in PostgreSQL so it is shared across serverless instances.
