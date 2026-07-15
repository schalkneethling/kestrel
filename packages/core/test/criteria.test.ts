import { describe, expect, it } from "vite-plus/test";
import { matchCriteria, matchesAnyCriteria, matchesCriteria } from "../src/index";
import type { Criteria, NormalizedJob } from "../src/index";

const job = (overrides: Partial<NormalizedJob> = {}): NormalizedJob => ({
  atsJobId: "job-1",
  title: "Senior Frontend Engineer",
  locationRaw: "Remote - EMEA",
  absoluteUrl: "https://example.com/jobs/1",
  companyId: "company-1",
  atsType: "greenhouse",
  sourceKey: "greenhouse:company-1:job-1",
  stableKey: "stable-1",
  location: { rawLabel: "Remote - EMEA", remoteScope: "remote", regions: ["emea"] },
  ...overrides,
});

describe("matching a job against saved criteria", () => {
  it("does not match when no criteria exist or every criteria set is disabled", () => {
    expect(matchesAnyCriteria(job(), [])).toBe(false);
    expect(matchesAnyCriteria(job(), [criteria({ enabled: false })])).toBe(false);
  });

  it("matches when at least one enabled criteria set matches", () => {
    const result = matchCriteria(job(), [
      criteria({ id: "backend", titleIncludes: ["backend"] }),
      criteria({ id: "frontend", titleIncludes: ["frontend"] }),
      criteria({ id: "disabled", enabled: false }),
    ]);

    expect(result).toEqual({ matches: true, matchedCriteriaIds: ["frontend"] });
    expect(matchesAnyCriteria(job(), [criteria({ titleIncludes: ["frontend"] })])).toBe(true);
  });

  it("keeps desired regions informational across multiple criteria sets", () => {
    expect(
      matchCriteria(job(), [criteria({ id: "another-region", regions: ["us", "za"] })]),
    ).toEqual({ matches: true, matchedCriteriaIds: ["another-region"] });
  });
});

const criteria = (overrides: Partial<Criteria> = {}): Criteria => ({
  id: "criteria-1",
  name: "Frontend roles",
  enabled: true,
  titleIncludes: [],
  titleExcludes: [],
  locationHardExcludes: [],
  regions: [],
  ...overrides,
});

describe("matchesCriteria", () => {
  it("matches enabled criteria without filters", () => {
    expect(matchesCriteria(job(), criteria())).toBe(true);
  });

  it("does not match disabled criteria", () => {
    expect(matchesCriteria(job(), criteria({ enabled: false }))).toBe(false);
  });

  it("matches when any title include is a case-insensitive substring", () => {
    expect(matchesCriteria(job(), criteria({ titleIncludes: ["backend", "FRONTEND"] }))).toBe(true);
  });

  it("requires a title include match when includes are configured", () => {
    expect(matchesCriteria(job(), criteria({ titleIncludes: ["designer", "backend"] }))).toBe(
      false,
    );
  });

  it("rejects when any title exclude is a case-insensitive substring", () => {
    expect(matchesCriteria(job(), criteria({ titleExcludes: ["manager", "SENIOR"] }))).toBe(false);
  });

  it("lets a title exclusion override an inclusion", () => {
    expect(
      matchesCriteria(
        job(),
        criteria({ titleIncludes: ["engineer"], titleExcludes: ["frontend"] }),
      ),
    ).toBe(false);
  });

  it("rejects only when an explicit location hard exclude matches the raw location", () => {
    expect(matchesCriteria(job(), criteria({ locationHardExcludes: ["antarctica", "EMEA"] }))).toBe(
      false,
    );
  });

  it("does not use desired regions to reject a job", () => {
    expect(matchesCriteria(job(), criteria({ regions: ["us", "za"] }))).toBe(true);
  });

  it("does not use location classification to reject a job", () => {
    expect(
      matchesCriteria(
        job({
          locationRaw: "New York, NY",
          location: { rawLabel: "New York, NY", remoteScope: "onsite", regions: ["us"] },
        }),
        criteria({ regions: ["emea"] }),
      ),
    ).toBe(true);
  });

  it("ignores empty and whitespace-only filter values", () => {
    expect(
      matchesCriteria(
        job(),
        criteria({
          titleIncludes: ["", "  "],
          titleExcludes: [" "],
          locationHardExcludes: ["", "   "],
        }),
      ),
    ).toBe(true);
  });

  it("trims configured filters before matching", () => {
    expect(
      matchesCriteria(
        job(),
        criteria({ titleIncludes: [" frontend "], locationHardExcludes: [" antarctica "] }),
      ),
    ).toBe(true);
  });
});
