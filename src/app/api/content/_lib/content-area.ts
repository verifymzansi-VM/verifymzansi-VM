import { z } from "zod";

export const contentAreaSchema = z.enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"], {
  message: "area must be MZANSI_MARKET, MZANSI_BUSINESS, or PROMOTIONS_EVENTS",
});

export const contentAreaTableMap = {
  MZANSI_MARKET: { table: "listings", ownerCompatible: true },
  MZANSI_BUSINESS: { table: "businesses", ownerCompatible: true },
  PROMOTIONS_EVENTS: { table: "promotions", ownerCompatible: true },
} as const;

export type ContentAreaTableConfig = (typeof contentAreaTableMap)[keyof typeof contentAreaTableMap];

type CompatibleContentTable = "listings" | "businesses" | "promotions";

export function isOwnerCompatibleContentTable(
  table: ContentAreaTableConfig["table"]
): table is CompatibleContentTable {
  return table === "listings" || table === "businesses" || table === "promotions";
}
