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

Deployment options
------------------

1) Docker (recommended for long-running Express worker)

- Build locally:

```bash
# build image
docker build -t insight-worker:latest .

# run container (map port 4001)
docker run -p 4001:4001 --env-file .env insight-worker:latest
```

- Platforms: Render, Railway, DigitalOcean App Platform accept Dockerfiles — push your repo and point the service to build the Docker image.

2) Vercel (serverless) — limitations

- Vercel doesn't support running a persistent Express server that listens on a port; it uses serverless functions instead. To deploy on Vercel you must either:
  - Convert API endpoints into serverless functions under an `api/` folder, or
  - Deploy the app as a Docker container on a platform that supports containers.

If you want, I can convert the `GET /health` endpoint and simple routes into Vercel serverless functions — tell me which routes you need, and I'll implement them.
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
