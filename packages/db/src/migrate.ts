import { runMigrations } from './index.js';

const result = await runMigrations();

if (result.applied.length > 0) {
  console.log(`Applied migrations: ${result.applied.join(', ')}`);
} else {
  console.log('No new migrations to apply.');
}

if (result.skipped.length > 0) {
  console.log(`Already applied: ${result.skipped.join(', ')}`);
}
