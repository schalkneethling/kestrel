import type { Company, Criteria } from "@kestrel/core";
import { D1Repository } from "./repository";

export type SeedData = { companies: Company[]; criteria: Criteria[] };

export async function seedDatabase(
  database: D1Database,
  seed: SeedData,
  now: () => string,
): Promise<void> {
  const repository = new D1Repository(database, now);
  for (const company of seed.companies) await repository.saveCompany(company);
  for (const entry of seed.criteria) await repository.saveCriteria(entry);
}
