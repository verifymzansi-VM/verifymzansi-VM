import { z } from "zod";

/**
 * Admin-editable commercial numbers (table `commercial_settings`). Prices live
 * on `plans`; trial capacity and toggles live on `intro_trial_campaigns`.
 * Defaults mirror the seeded rows so pages render before the DB answers.
 */
const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const COMMERCIAL_SETTING_SCHEMAS = {
  trials: z.object({ shortDays: int(1, 30), longDays: int(7, 90) }).strict(),
  strategic: z
    .object({
      durationDays: int(7, 366),
      slotCapacity: int(1, 50),
      activationLimitTotal: int(1, 500),
    })
    .strict(),
  founding_commercial: z
    .object({
      durationDays: int(7, 366),
      slotCapacity: int(1, 1000),
      activationsPerPeriod: int(1, 5000),
      periodDays: int(1, 90),
      adminLimit: int(1, 20),
    })
    .strict(),
  founding_organisation: z
    .object({
      durationDays: int(7, 366),
      sponsoredCapacity: int(0, 10000),
      adminLimit: int(1, 20),
      alertDays: z.array(int(1, 180)).min(1).max(8),
    })
    .strict(),
  retail: z
    .object({
      activationsPerPeriod: int(1, 1000),
      periodDays: int(1, 90),
      labels: z
        .object({
          month: z.string().max(30),
          half_year: z.string().max(30),
          year: z.string().max(30),
        })
        .strict(),
    })
    .strict(),
  partner: z
    .object({ commissionBps: int(0, 5000), pendingDays: int(0, 180), enabled: z.boolean() })
    .strict(),
  media: z
    .object({
      maxPhotos: int(1, 30),
      maxImageMb: int(1, 25),
      maxVideos: int(0, 27),
      maxVideoMb: int(5, 500),
      storageQuotaMb: int(50, 100000),
    })
    .strict(),
  events: z
    .object({
      maxActivePerAccount: int(1, 500),
      maxCreatedPer30Days: int(1, 1000),
      defaultVisibilityDays: int(1, 365),
      archiveAfterDays: int(1, 365),
      maxPhotos: int(1, 30),
      maxVideos: int(0, 10),
    })
    .strict(),
  showroom: z.object({ programmeMinItems: int(1, 48), programmeMaxCards: int(1, 48) }).strict(),
  features: z
    .object({
      enterpriseCheckout: z.boolean(),
      organisationsPublic: z.boolean(),
      partnerProgramme: z.boolean(),
      qualityScore: z.boolean(),
    })
    .strict(),
} as const;

export type CommercialSettingKey = keyof typeof COMMERCIAL_SETTING_SCHEMAS;
export type CommercialSettings = {
  [K in CommercialSettingKey]: z.infer<(typeof COMMERCIAL_SETTING_SCHEMAS)[K]>;
};

export const DEFAULT_COMMERCIAL_SETTINGS: CommercialSettings = {
  trials: { shortDays: 7, longDays: 30 },
  strategic: { durationDays: 90, slotCapacity: 1, activationLimitTotal: 3 },
  founding_commercial: {
    durationDays: 180,
    slotCapacity: 25,
    activationsPerPeriod: 50,
    periodDays: 30,
    adminLimit: 2,
  },
  founding_organisation: {
    durationDays: 180,
    sponsoredCapacity: 50,
    adminLimit: 3,
    alertDays: [60, 30, 14, 7],
  },
  retail: {
    activationsPerPeriod: 10,
    periodDays: 30,
    labels: { month: "Flexible", half_year: "Most popular", year: "Best value" },
  },
  partner: { commissionBps: 2000, pendingDays: 30, enabled: true },
  media: { maxPhotos: 10, maxImageMb: 5, maxVideos: 1, maxVideoMb: 50, storageQuotaMb: 500 },
  events: {
    maxActivePerAccount: 5,
    maxCreatedPer30Days: 10,
    defaultVisibilityDays: 30,
    archiveAfterDays: 30,
    maxPhotos: 10,
    maxVideos: 1,
  },
  showroom: { programmeMinItems: 3, programmeMaxCards: 12 },
  features: {
    enterpriseCheckout: true,
    organisationsPublic: true,
    partnerProgramme: true,
    qualityScore: true,
  },
};

export const COMMERCIAL_SETTING_LABELS: Record<CommercialSettingKey, string> = {
  trials: "Public trial durations",
  strategic: "Strategic Individual trial",
  founding_commercial: "Founding Commercial Partner (dealerships)",
  founding_organisation: "Founding Organisation Programme",
  retail: "Retail slot fair use & labels",
  partner: "Partner commission",
  media: "Media limits",
  events: "Free event fair use",
  showroom: "Programme showroom",
  features: "Feature toggles",
};

export function isCommercialSettingKey(key: string): key is CommercialSettingKey {
  return Object.prototype.hasOwnProperty.call(COMMERCIAL_SETTING_SCHEMAS, key);
}

/** Merge DB rows over defaults; invalid rows fall back to defaults. */
export function resolveCommercialSettings(
  rows: ReadonlyArray<{ key: string; value: unknown }> | null | undefined
): CommercialSettings {
  const settings = structuredClone(DEFAULT_COMMERCIAL_SETTINGS) as Record<string, unknown>;
  for (const row of rows ?? []) {
    if (!isCommercialSettingKey(row.key)) continue;
    const merged =
      row.value && typeof row.value === "object"
        ? { ...(settings[row.key] as object), ...(row.value as object) }
        : row.value;
    const parsed = COMMERCIAL_SETTING_SCHEMAS[row.key].safeParse(merged);
    if (parsed.success) settings[row.key] = parsed.data;
  }
  return settings as CommercialSettings;
}

type SettingsReader = {
  from: (table: "commercial_settings") => {
    select: (columns: string) => PromiseLike<{
      data: Array<{ key: string; value: unknown }> | null;
      error: { message: string } | null;
    }>;
  };
};

let cache: { at: number; value: CommercialSettings } | null = null;
const CACHE_MS = 60_000;

export async function getCommercialSettings(client: SettingsReader): Promise<CommercialSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const { data, error } = await client.from("commercial_settings").select("key, value");
  if (error) return cache?.value ?? DEFAULT_COMMERCIAL_SETTINGS;
  const value = resolveCommercialSettings(data);
  cache = { at: Date.now(), value };
  return value;
}

export function clearCommercialSettingsCache(): void {
  cache = null;
}
