// Starting a long-running background worker is not supported on Vercel serverless.
export default function handler(_req: any, res: any) {
  res.status(501).json({
    error: 'Not supported on serverless: background worker cannot be started from a function. Use Docker or a VM instead.'
  });
}
