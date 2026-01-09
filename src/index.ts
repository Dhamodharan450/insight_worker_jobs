import dotenv from 'dotenv';
dotenv.config();

const mode = process.env.MODE || process.argv[2] || 'worker';

if (mode === 'api') {
  // start API wrapper
  // Imported dynamically to keep startup fast for worker
  import('./server').then((m) => {
    // server starts itself
  }).catch((e) => {
    console.error('Failed to start API server', e);
    process.exit(1);
  });
} else {
  // start worker loop
  import('./insight.worker').then((m) => {
    m.startWorker();
  }).catch((e) => {
    console.error('Failed to start worker', e);
    process.exit(1);
  });
}
