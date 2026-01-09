import express from 'express';
import { PrismaClient } from '@prisma/client';
import { processJob, startWorker } from './insight.worker';

const app = express();
app.use(express.json());
const db = new PrismaClient();

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/worker/start', async (req, res) => {
  startWorker();
  res.json({ started: true });
});

app.post('/jobs/:id/run', async (req, res) => {
  try {
    const id = req.params.id;
    const job = await (db as any).insight_job_logs.findUnique({ where: { id } });
    if (!job) return res.status(404).json({ error: 'job not found' });
    const insights = await db.insight_v2.findUnique({
      where: { id: job.insightv2_id }, include: {
        children: true,
        kpis: {
          include: {
            kpi: {
              include: { kpi_tables: { include: { data_table: { include: { table_schema: true } }, kpi_columns: true } } }
            }
          }
        },
        kpi: { include: { kpi_tables: { include: { data_table: { include: { table_schema: true } }, kpi_columns: true } } } }
      }
    });
    await processJob(job, insights);
    res.json({ status: 'processed' });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`insight-worker API listening on ${PORT}`));
