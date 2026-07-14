import type { NormalizedJob } from "./domain";
import type { Criteria } from "./persistence";

const normalizeFilters = (values: readonly string[]) =>
  values.map((value) => value.trim().toLowerCase()).filter(Boolean);

const containsAny = (value: string, filters: readonly string[]) => {
  const normalizedValue = value.toLowerCase();
  return filters.some((filter) => normalizedValue.includes(filter));
};

/** Evaluates one normalized job against one saved criteria set. */
export function matchesCriteria(job: NormalizedJob, criteria: Criteria): boolean {
  if (!criteria.enabled) return false;

  const titleIncludes = normalizeFilters(criteria.titleIncludes);
  const titleExcludes = normalizeFilters(criteria.titleExcludes);
  const locationHardExcludes = normalizeFilters(criteria.locationHardExcludes);

  if (titleIncludes.length > 0 && !containsAny(job.title, titleIncludes)) return false;
  if (containsAny(job.title, titleExcludes)) return false;

  return !containsAny(job.locationRaw, locationHardExcludes);
}

export type CriteriaMatch = {
  matches: boolean;
  matchedCriteriaIds: string[];
};

/**
 * Evaluates a job against all saved criteria. With no enabled criteria there is
 * no match; otherwise a match from any enabled set is sufficient.
 */
export function matchCriteria(job: NormalizedJob, criteria: readonly Criteria[]): CriteriaMatch {
  const matchedCriteriaIds = criteria
    .filter((value) => matchesCriteria(job, value))
    .map(({ id }) => id);
  return { matches: matchedCriteriaIds.length > 0, matchedCriteriaIds };
}

export function matchesAnyCriteria(job: NormalizedJob, criteria: readonly Criteria[]): boolean {
  return matchCriteria(job, criteria).matches;
}
