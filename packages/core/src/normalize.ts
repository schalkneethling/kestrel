import type { Company, NormalizedJob, RawJob } from "./domain";
import { isSupportedAtsType } from "./domain";
import { createSourceKey, createStableKey } from "./identity";
import { classifyLocation } from "./location";

export function normalizeJob(company: Company, job: RawJob): NormalizedJob {
  if (!isSupportedAtsType(company.atsType))
    throw new TypeError(`Cannot normalize unsupported ATS type: ${company.atsType}`);
  const location = classifyLocation(job.locationRaw);
  const stableKey = createStableKey({
    companyId: company.id,
    title: job.title,
    location,
    department: job.department,
    employmentType: job.employmentType,
  });
  if (!stableKey) throw new TypeError("A normalized job requires a company ID and title");
  return {
    ...job,
    companyId: company.id,
    atsType: company.atsType,
    sourceKey: createSourceKey(company.id, company.atsType, job.atsJobId),
    stableKey,
    location,
  };
}
