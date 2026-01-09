/* eslint-disable prettier/prettier */

import { PrismaClient } from '@prisma/client';
import { MastraClient } from '@mastra/client-js';
import { createConnectionString } from './utils/database/connection';

const db = new PrismaClient();

const mastraClient = new MastraClient({
    baseUrl: process.env.TENANTS_CREATE_API || 'http://localhost:4111',
});

type RawSchedule = {
    time: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    weekly_day?: string;
    monthly_day?: number;
};

type NormalizedSchedule = {
    time: string;
    hour: number;
    minute: number;
    frequency: 'daily' | 'weekly' | 'monthly';
    weekly_day?: string;
    weekly_day_num?: number;
    monthly_day?: number;
};

function normalizeSchedules(schedules: RawSchedule[]): NormalizedSchedule[] {
    const dayMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3,
        Thu: 4, Fri: 5, Sat: 6,
    };

    return schedules.map((s) => {
        const [hour, minute] = s.time.split(':').map(Number);
        const normalized: NormalizedSchedule = {
            time: s.time,
            hour,
            minute,
            frequency: s.frequency,
        };
        if (s.frequency === 'weekly') {
            normalized.weekly_day = s.weekly_day;
            normalized.weekly_day_num = dayMap[s.weekly_day!];
        }
        if (s.frequency === 'monthly') {
            normalized.monthly_day = s.monthly_day;
        }
        return normalized;
    });
}

function applyScheduleTime(date: Date, time: string) {
    console.log(date, time, 'time')
    const [hh, mm] = time.split(':').map(Number);
    const d = new Date(date);
    d.setUTCHours(hh, mm, 0, 0);
    return d;
}

function generateScheduledIntervals(nowIso: string, schedule: any, runs: number) {
    const intervals: any = [];
    let end: any = new Date(nowIso);
    end = applyScheduleTime(end, schedule.time);

    for (let i = 0; i < runs; i++) {
        let start: any = new Date(end);
        switch (schedule.frequency) {
            case 'daily':
                start.setUTCDate(start.getUTCDate() - 1);
                break;
            case 'weekly': {
                if (schedule.weekly_day === undefined) throw new Error('weekly_day is required for weekly frequency');
                const currentDow = start.getUTCDay();
                const diff = (currentDow - schedule.weekly_day + 7) % 7 || 7;
                start.setUTCDate(start.getUTCDate() - diff);
                break;
            }
            case 'monthly': {
                if (schedule.monthly_day === undefined) throw new Error('monthly_day is required for monthly frequency');
                start.setUTCMonth(start.getUTCMonth() - 1);
                start.setUTCDate(Math.min(schedule.monthly_day, new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()));
                break;
            }
            default:
                throw new Error(`Unsupported frequency`);
        }
        start = applyScheduleTime(start, schedule.time);
        intervals.push({
            window_date: start.toISOString(),
            start_ts: start.toISOString(),
            end_ts: end.toISOString()
        });
        end = start;
    }
    return intervals;
}

function buildAiPrompt(baseQuery: string, schedule: NormalizedSchedule, runs: number): string {
    console.log(baseQuery, schedule, runs, 'pays')
    const now = new Date().toISOString();
    const intervals = generateScheduledIntervals(now, schedule, runs);
    return `You are an expert PostgreSQL SQL generator.

Base Query:
${baseQuery}

IMPORTANT (STRICT):
- DO NOT calculate dates or intervals.
- DO NOT use NOW(), CURRENT_TIMESTAMP, or clock functions.
- DO NOT infer or shift time.
- USE ONLY the provided interval timestamps exactly as given.

Provided Time Windows (MANDATORY):
Each object represents one window and must be used as-is.

${JSON.stringify(intervals, null, 2)}

CTE Requirements (MANDATORY):
- Use CTEs exactly named:
  1. params
  2. series
  3. windows
  4. final

Window Requirements:
- Each window must include:
  - window_date
  - start_ts
  - end_ts
- Windows must appear in the same order as provided.
- Do NOT reorder or merge windows.

Base Query Handling (STRICT):
- Replace ONLY the date filter portion of the base query.
- Use:date_column >= start_ts
    AND date_column < end_ts
- Do NOT modify joins, grouping, filters, or aggregations.

Goal:
Generate a final PostgreSQL SQL query that:
- Uses the provided windows exactly
- Filters data using start_ts and end_ts
- Produces results per window
- Contains NO time calculations
`;
}

async function fetchInsightWithChildren(insightId: string) {
    const insight = await db.insight_v2.findUnique({
        where: { id: insightId },
        include: {
            children: true,
            kpis: {
                include: {
                    kpi: {
                        include: {
                            kpi_tables: {
                                include: {
                                    data_table: { include: { table_schema: true } },
                                    kpi_columns: true,
                                },
                            },
                        },
                    },
                },
            },
            kpi: {
                include: {
                    kpi_tables: {
                        include: {
                            data_table: { include: { table_schema: true } },
                            kpi_columns: true,
                        },
                    },
                },
            },
        },
    });

    if (!insight) return null;

    if (insight.children?.length) {
        insight.children = await Promise.all(
            insight.children.map((child) => fetchInsightWithChildren(child.id))
        );
    }
    return insight;
}

async function getLatestLogsPerFrequency(insightId: string, frequency?: string, limit: number = 2) {
    const whereClause: any = { insightv2_id: insightId };
    if (frequency) whereClause.frequency = frequency;
    const logs = await db.insight_execution_log.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
    });

    const result: Record<string, Record<string, any[]>> = { daily: {}, weekly: {}, monthly: {} };
    for (const log of logs) {
        const freq = log.frequency!;
        const kpiName = log.kpi_name!;
        if (!result[freq]) continue;
        if (!result[freq][kpiName]) result[freq][kpiName] = [];
        result[freq][kpiName].push(log);
    }
    return result;
}

async function collectLogsForInsightTree(insightNode: any, frequency?: string, limit: number = 2) {
    const result: any[] = [];
    const logsByFrequency = await getLatestLogsPerFrequency(insightNode.id, frequency, limit);
    result.push({ insightId: insightNode.id, logs: logsByFrequency });

    if (insightNode.children?.length) {
        for (const child of insightNode.children) {
            const childLogs = await collectLogsForInsightTree(child, frequency, limit);
            result.push(...childLogs);
        }
    }
    return result;
}

async function buildKpiPayload(insightNode: any, allLogs: any) {
    const insightLogs = allLogs.find((l: any) => String(l.insightId) === String(insightNode.id));
    const kpiMap: Record<string, any> = {};

    if (insightLogs?.logs) {
        for (const [frequency, kpiGroup] of Object.entries(insightLogs.logs)) {
            for (const [kpiName, logs] of Object.entries(kpiGroup as Record<string, any[]>)) {
                const key = `${kpiName}|${frequency}`;
                if (!kpiMap[key]) {
                    const kpiDef = insightNode.kpis?.find((k: any) => k.kpi?.name === kpiName)?.kpi || insightNode.kpi;
                    kpiMap[key] = {
                        kpi_name: kpiName?.trim() || kpiDef?.name || 'Unnamed KPI',
                        kpi_value: [],
                        executed_at: [],
                        frequency,
                        sql_query: kpiDef?.sql_query || null,
                    };
                }
                for (const log of logs) {
                    kpiMap[key].kpi_value.push(log.kpi_value != null ? Number(log.kpi_value) : Number(log.value ?? 0));
                    kpiMap[key].executed_at.push(log.createdAt);
                }
            }
        }
    }

    const parent = Object.values(kpiMap);
    const childPayloads: any[] = await Promise.all((insightNode.children || []).map((child: any) => buildKpiPayload(child, allLogs)));
    const children = childPayloads.filter((c) => c.parent?.length > 0 || c.children);
    const result: any = { parent };
    if (children.length > 0) result.children = children;
    return result;
}

async function processJob(job: any, insight: any) {
    try {
        console.log(`[Worker] Processing job ${job.id} for Insight ${job.insightv2_id}`);

        // Remove DB call for insight since it is passed
        // const insight = await db.insight_v2.findUnique({ where: { id: job.insightv2_id } });
        if (!insight) throw new Error('Insight not found');

        let runs = 0;

        if (job.frequency === 'daily') runs = 30;
        if (job.frequency === 'weekly') runs = 15;
        if (job.frequency === 'monthly') runs = 15;

        let query = job.sql_query;

        if (!job.kpi_id) throw new Error('KPI ID missing in job log');

        // Find KPI from the passed insight object
        const kpiWrapper = insight.kpis?.find((k: any) => k.kpi_id === job.kpi_id);
        const kpi = kpiWrapper?.kpi;

        if (!kpi) throw new Error('KPI not found in insight');
        const queryToUse = kpi.sql_query;

        const tables = kpi.kpi_tables.map((kt: any) => {
            const table = kt.data_table;
            const fields = (table.table_schema || []).map((col: any) => ({
                field_name: col.column_name || col.field_name || '',
                field_type: col.data_type || col.type || 'string',
            }));
            return {
                name: table.table_name || '',
                schema_name: table.schema_name || 'public',
                fields,
            };
        });

        const application: any = await db.application.findFirst({ where: { id: insight.applicationId } });
        if (!application?.meta_data?.connection) throw new Error('No connection');
        const connectionString = createConnectionString(application.meta_data.connection, application.meta_data.type);
        const databaseType = application.meta_data.type;

        console.log('🔵 Building AI prompt...');
        const promptSchedule: any = {
            time: job.schedule_time,
            frequency: job.frequency,
            weekly_day: job.weekly_day,
            monthly_day: job.monthly_day
        };


        const prompt = buildAiPrompt(queryToUse, promptSchedule, runs);

        const sqlTool = mastraClient.getTool('sql-generation');
        const executeSql = mastraClient.getTool('sql-execution');

        const result = await sqlTool.execute({
            data: { expandedQuery: prompt, tables },
            runtimeContext: {
                connectionString,
                databaseType,
                tenantId: insight.applicationId,
                applicationId: insight.applicationId,
            },
        });

        if (!result?.sql) throw new Error('No SQL generated');

        const executionResult: any = await executeSql.execute({
            data: { query: result.sql, generateChart: true },
            runtimeContext: { connectionString, databaseType },
        });

        if (!executionResult?.success) throw new Error('Execution failed');

        await Promise.all(
            executionResult.data.map((row: any) => {
                const valueKey = Object.keys(row).find(k => k !== 'window_date');
                const value = Number(row[valueKey]) || 0;
                return db.insight_execution_log.create({
                    data: {
                        insightv2_id: insight.id,
                        frequency: job.frequency,
                        schedule_time: row.window_date,
                        weekly_day: job.weekly_day ?? null,
                        monthly_day: job.monthly_day ?? null,
                        kpi_value: value,
                        scheduled_kpi_value: value,
                        sql_query: result.sql,
                        sql_execution_data: JSON.stringify(row),
                        createdAt: row.window_date,
                        kpi_name: job.kpi_name,
                    },
                });
            })
        );

        const insightNode = await fetchInsightWithChildren(insight.id);
        const allLogs = await collectLogsForInsightTree(insightNode, job.frequency, 10);
        const diagnosticLogs = allLogs.map((entry: any) => ({
            ...entry,
            logs: Object.entries(entry.logs).reduce((acc: any, [freq, kpiMap]: any) => {
                acc[freq] = Object.entries(kpiMap).reduce((kAcc: any, [kpi, logs]: any) => {
                    kAcc[kpi] = (logs as any).slice(0, 2);
                    return kAcc;
                }, {});
                return acc;
            }, {})
        }));

        const kpiPayload = await buildKpiPayload(insightNode, diagnosticLogs);
        const diagnosticTool = mastraClient.getTool('kpi-diagnostic');
        const diagnosticResult = await diagnosticTool.execute({
            data: { raw_json: JSON.stringify({ kpi_data: [kpiPayload] }) },
            runtimeContext: { connectionString, databaseType, tenantId: insight.applicationId, applicationId: insight.applicationId },
        });

        const flatPayload: any[] = [];
        const kpiNamesSet = new Set<string>();
        allLogs.forEach((insightData: any) => {
            if (insightData.logs) {
                Object.values(insightData.logs).forEach((freqGroup: any) => {
                    Object.values(freqGroup).forEach((kpiLogs: any) => {
                        const latestLogs = (kpiLogs as any).slice(0, 10);
                        latestLogs.forEach((log: any) => {
                            flatPayload.push({
                                kpi_name: log.kpi_name,
                                kpi_value: Number(log.kpi_value),
                                executed_at: log.createdAt,
                                frequency: log.frequency
                            });
                            kpiNamesSet.add(log.kpi_name);
                        });
                    });
                });
            }
        });

        const predictionTool = mastraClient.getTool('multi-kpi-predictive-forecasting');
        const predictionResult = await predictionTool.execute({
            data: {
                kpi_names: Array.from(kpiNamesSet),
                forecast_horizon: 14,
                parallel: true,
                include_perspective: true,
                data_source: { mode: 'payload', payload: flatPayload },
            },
            runtimeContext: { connectionString, databaseType, tenantId: insight.applicationId, applicationId: insight.applicationId },
        });

        await (db as any).insight_job_logs.update({
            where: { id: job.id },
            data: {
                executed_status: 'completed',
                sql_execution_data: JSON.stringify(executionResult.data),
                sql_query: result.sql,
                generated_metaData: JSON.stringify(result),
                executed_metaData: JSON.stringify(executionResult),
                success_log: JSON.stringify({ message: "Job completed successfully" })
            }
        });

        await db.insight_prescriptive_predective_log.create({
            data: {
                generated_metaData: flatPayload,
                insightv2_id: insight.id,
                executed_metaData: predictionResult,
                kpi_name: job.kpi_name,
                frequency: job.frequency,
                summary: predictionResult.summary,
                prescriptive_recommendation: predictionResult.perspective.recommendations,
                predictive_forecasts: predictionResult.forecasts,
                highlights: predictionResult.highlights,
            }
        });

        console.log(`[Worker] Job ${job.id} completed`);

    } catch (err: any) {
        console.error(`[Worker] Job ${job.id} failed:`, err);
        await (db as any).insight_job_logs.update({
            where: { id: job.id },
            data: {
                executed_status: 'failed',
                error_log: JSON.stringify(err.message || err),
            }
        });
    }
}

const workerType = process.argv[2] || 'execution';

async function startWorker() {
    console.log(`[Worker] Started in ${workerType} mode`);
    while (true) {
        try {
            const job = await (db as any).insight_job_logs.findFirst({
                where: { executed_status: 'queued' },
                orderBy: { createdAt: 'asc' }
            });
            console.log(job, 'job');

            if (job) {
                const claimed = await (db as any).insight_job_logs.updateMany({
                    where: { id: job.id, executed_status: 'queued' },
                    data: { executed_status: 'processing' }
                });

                if (claimed.count > 0) {
                    const insights = await db.insight_v2.findUnique({
                        where: { id: job.insightv2_id }, include: {
                            children: true,
                            kpis: {
                                include: {
                                    kpi: {
                                        include: {
                                            kpi_tables: {
                                                include: {
                                                    data_table: {
                                                        include: { table_schema: true },
                                                    },
                                                    kpi_columns: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            },

                            kpi: {
                                include: {
                                    kpi_tables: {
                                        include: {
                                            data_table: {
                                                include: { table_schema: true },
                                            },
                                            kpi_columns: true,
                                        },
                                    },
                                },
                            },
                        },
                    })
                    await processJob(job, insights);
                }
            } else {
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (e) {
            console.error('[Worker] Loop error', e);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

export { processJob, startWorker };

if (require.main === module) {
    startWorker();
}
