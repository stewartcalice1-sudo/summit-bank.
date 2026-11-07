# Summit Bank

A from-scratch, investor-demonstration banking application. It includes customer registration and login, checking/savings accounts, a persistent double-entry ledger, transfers, person-to-person payment workflows, transaction history, statements, notifications, and an administrative console.

## Important operating boundary

This project runs a **simulated banking ledger**. It does not hold deposits, move real money, connect to Zelle, issue payment credentials, or provide regulated banking services. The payment interface demonstrates a Zelle-style person-to-person workflow; the Summit-branded payment simulation is not a Zelle network integration. Do not present simulated balances or transactions as real funds or claim FDIC insurance or banking authorization.

For live banking, engage a sponsor bank and authorized payment providers, complete required compliance and security reviews, and replace the simulation adapters with their approved APIs.

## Requirements

- Node.js 20+
- npm
- A build environment capable of installing `better-sqlite3` (prebuilt binaries are normally used; otherwise local build tools may be required).

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Open http://localhost:3000.

Before deployment, set a unique `SESSION_SECRET` (32+ random characters), change `ADMIN_PASSWORD`, set `NODE_ENV=production`, and use persistent storage for `DATABASE_PATH`. The default local admin account is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` on first boot. Change the password immediately after first login.

## Demo access

On first boot, the app creates an administrator using the environment variables. It does **not** create fake customer accounts or pre-populated balances. Register a customer account to explore the user experience. The administrator can inspect registered accounts and transactions.

## Tests

```bash
npm test
```

Tests use a temporary database and do not touch the live application database.

## GitHub

Create an empty GitHub repository, extract this ZIP, then:

```bash
git init
git add .
git commit -m "Initial Summit Bank application"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

Never commit `.env`, database files, production secrets, or customer data.

## Production checklist

- Use HTTPS behind a trusted reverse proxy or managed ingress.
- Set strong secrets and unique administrator credentials.
- Use persistent, encrypted storage and tested backups.
- Restrict admin access with MFA at the identity/provider layer before real deployment.
- Add monitoring, alerting, vulnerability scanning, penetration testing, and incident response.
- Configure email/SMS delivery providers for recovery and notifications.
- Complete legal, regulatory, privacy, accessibility, and security reviews.
- Replace simulated money movement with sponsor-bank and payment-provider integrations only after authorization.
