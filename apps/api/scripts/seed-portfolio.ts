import { seedRealPortfolio } from '../../../packages/db/src/seed-real-portfolio';

seedRealPortfolio().catch((err) => {
  console.error('SEEDING FAILED:', err);
  process.exit(1);
});
