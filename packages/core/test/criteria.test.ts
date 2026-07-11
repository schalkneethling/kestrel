import { describe, expect, it } from "vite-plus/test";
import { matchesCriteria } from "../src/index";
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
