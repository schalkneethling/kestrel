import type { LocationClassification, SupportedAtsType } from "./domain";

export type StableKeyInput = {
  companyId: string;
  title: string | readonly string[];
  location: Omit<LocationClassification, "remoteScope" | "rawLabel"> & {
    remoteScope:
      | LocationClassification["remoteScope"]
      | readonly LocationClassification["remoteScope"][];
    rawLabel: string | readonly string[];
  };
  department?: string | readonly string[];
  employmentType?: string | readonly string[];
};

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
const candidates = (value?: string | readonly string[]) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [value])
        .filter((item): item is string => typeof item === "string")
        .map(normalize)
        .filter(Boolean),
    ),
  ].sort();
const resolved = (value?: string | readonly string[]) => candidates(value).join(",");
const optional = (value?: string | readonly string[]) => {
  const result = resolved(value);
  return result ? encodeURIComponent(result) : "~";
};

export function createSourceKey(companyId: string, atsType: SupportedAtsType, atsJobId: string) {
  return `${encodeURIComponent(companyId)}:${atsType}:${encodeURIComponent(atsJobId)}`;
}

export function createStableKey(input: StableKeyInput): string | null {
  const title = resolved(input.title);
  if (!input.companyId.trim() || !title) return null;
  const regions = [...new Set(input.location.regions.map(normalize).filter(Boolean))].sort();
  const scopes = candidates(input.location.remoteScope);
  const scope = scopes.length > 1 ? `conflict:${scopes.join(",")}` : (scopes[0] ?? "unknown");
  const locationValue = regions.length
    ? `${scope}:${regions.join(",")}`
    : `${scope}:${resolved(input.location.rawLabel)}`;
  return `v1|company=${encodeURIComponent(input.companyId)}|title=${encodeURIComponent(title)}|location=${encodeURIComponent(locationValue)}|department=${optional(input.department)}|employment=${optional(input.employmentType)}`;
}
