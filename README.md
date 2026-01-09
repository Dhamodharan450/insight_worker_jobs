# Insight Worker (standalone)

This folder contains a minimal standalone copy of the `insight.worker` logic from the main repo.

Quick steps:

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `TENANTS_CREATE_API`.
2. Install deps:

```bash
npm install
npx prisma generate
```

3. Run in dev (ts-node):

```bash
npm run dev
```

4. Start API wrapper (to trigger jobs manually):

```bash
npm run api
```

5. Build for production:

```bash
npm run build
npm start
```

Notes:
- Ensure the `prisma/schema.prisma` and `DATABASE_URL` match your database used by the main app.
- The worker expects the same DB schema and Prisma client shape.
"# insight_worker_jobs" 
