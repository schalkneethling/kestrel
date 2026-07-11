export const SUPPORTED_ATS_TYPES = ["greenhouse", "lever", "ashby"] as const;
export type SupportedAtsType = (typeof SUPPORTED_ATS_TYPES)[number];
export type AtsType = SupportedAtsType | "unsupported";
export type CompanyStatus = "active" | "paused" | "unsupported";

export type Company = {
  id: string;
  name: string;
  atsType: AtsType;
  boardToken: string | null;
  careersUrl: string;
  status: CompanyStatus;
  unsupportedPlatform?: string | null;
  notes?: string | null;
};

export type RawJob = {
  atsJobId: string;
  title: string;
  locationRaw: string;
  department?: string;
  employmentType?: string;
  absoluteUrl: string;
  descriptionSnippet?: string;
  updatedAt?: string;
};

export type RemoteScope = "onsite" | "remote" | "hybrid" | "unknown";
export type LocationClassification = {
  remoteScope: RemoteScope;
  regions: string[];
  rawLabel: string;
};

export type NormalizedJob = RawJob & {
  companyId: string;
  atsType: SupportedAtsType;
  sourceKey: string;
  stableKey: string;
  location: LocationClassification;
};

export function isSupportedAtsType(value: string): value is SupportedAtsType {
  return SUPPORTED_ATS_TYPES.includes(value as SupportedAtsType);
}
