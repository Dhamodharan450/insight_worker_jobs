import { PrismaClient } from '@prisma/client';
import { processJob } from '../../../src/insight.worker';

const db = new PrismaClient();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query as { id?: string };
  if (!id) return res.status(400).json({ error: 'missing id' });

  try {
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
    res.status(500).json({ error: e?.message || String(e) });
  }
}
