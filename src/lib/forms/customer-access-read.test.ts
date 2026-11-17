import { describe, expect, it } from "vitest";
import { customerAccessSchema } from "./customer-access";
import { CUSTOMER_ACCESS_OPTIONS, readPublishedCustomerAccess } from "./customer-access-read";

/** Small deterministic generator, so a failure always reproduces. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const ABSENT = Symbol("absent");
const text = (length: number) => "a".repeat(length);
const VALUES = {
  version: [2, 1, "2", null, ABSENT],
  methods: [
    ["visit"],
    ["travel"],
    ["delivery"],
    ["online"],
    ["visit", "delivery"],
    ["travel", "online", "delivery"],
    ["visit", "visit"],
    [],
    ["walk-in"],
    ["visit", 3],
    "visit",
    null,
    ABSENT,
  ],
  premises: [
    "standalone_shop",
    "mall_store",
    "home_business",
    "market_stall",
    "kiosk",
    "",
    null,
    4,
    ABSENT,
  ],
  venue: [
    "Gateway",
    "  Gateway  ",
    "   ",
    "",
    text(160),
    ` ${text(160)} `,
    text(161),
    12,
    null,
    ABSENT,
  ],
  serviceAreas: [
    "Durban",
    "Durban, Umhlanga",
    " , ",
    ",",
    "",
    text(2000),
    text(2001),
    [],
    null,
    ABSENT,
  ],
  deliveryAreas: [
    "KwaZulu-Natal",
    " , Gauteng",
    ",,",
    "",
    ` ${text(2000)} `,
    text(2001),
    false,
    null,
    ABSENT,
  ],
  nationwide: [true, false, "true", 0, null, ABSENT],
  publishAddress: [true, false, "false", null, ABSENT],
  extra: ["kept-out", ABSENT],
} as const;

function build(pick: (options: readonly unknown[]) => unknown): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const [key, options] of Object.entries(VALUES)) {
    const chosen = pick(options);
    if (chosen !== ABSENT) value[key] = chosen;
  }
  return value;
}

function expectSameAsSchema(value: unknown) {
  const parsed = customerAccessSchema.safeParse(value);
  const read = readPublishedCustomerAccess(value);
  if (parsed.success) {
    expect(read, JSON.stringify(value)).toEqual(parsed.data);
  } else {
    expect(read, JSON.stringify(value)).toBeNull();
  }
  return parsed.success;
}

describe("readPublishedCustomerAccess", () => {
  it("rejects values that are not objects, as the schema does", () => {
    for (const value of [undefined, null, 2, "visit", true, [], [{ version: 2 }]]) {
      expectSameAsSchema(value);
    }
  });

  it("gives the schema's result for every complete answer a form can save", () => {
    let accepted = 0;
    for (const methods of [
      ["visit"],
      ["travel"],
      ["delivery"],
      ["online"],
      ["visit", "travel", "delivery", "online"],
    ]) {
      for (const premises of [
        "standalone_shop",
        "mall_store",
        "home_business",
        "market_stall",
        undefined,
      ]) {
        for (const venue of ["Gateway", "", undefined]) {
          for (const serviceAreas of ["Durban, Umhlanga", "", undefined]) {
            for (const deliveryAreas of ["Gauteng", "", undefined]) {
              for (const nationwide of [true, false, undefined]) {
                const value = {
                  version: 2,
                  methods,
                  ...(premises === undefined ? {} : { premises }),
                  ...(venue === undefined ? {} : { venue }),
                  ...(serviceAreas === undefined ? {} : { serviceAreas }),
                  ...(deliveryAreas === undefined ? {} : { deliveryAreas }),
                  ...(nationwide === undefined ? {} : { nationwide }),
                  publishAddress: false,
                };
                if (expectSameAsSchema(value)) accepted += 1;
              }
            }
          }
        }
      }
    }
    // The matrix must exercise both outcomes.
    expect(accepted).toBeGreaterThan(50);
  });

  it("gives the schema's result for 20,000 mixed valid and malformed values", () => {
    const random = seeded(20261111);
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      // Mostly the leading (well-formed) options, so both outcomes stay common.
      const value = build((options) =>
        random() < 0.75
          ? options[Math.floor(random() * Math.min(3, options.length))]
          : options[Math.floor(random() * options.length)]
      );
      if (expectSameAsSchema(value)) accepted += 1;
    }
    expect(accepted).toBeGreaterThan(500);
    expect(accepted).toBeLessThan(19_500);
  });

  it("counts length in characters as zod does, emoji and rare CJK included", () => {
    const emoji = "🏪"; // two UTF-16 units, one character
    const cjk = "𠀀"; // CJK Extension B, also two units
    const values: string[] = [
      emoji.repeat(160),
      emoji.repeat(161),
      `${emoji.repeat(80)}a`,
      cjk.repeat(160),
      ` ${cjk.repeat(159)}b `,
      "�".repeat(160), // lone high surrogates count one each
      "�".repeat(161),
      "��".repeat(80),
    ];
    for (const venue of values) {
      expectSameAsSchema({ version: 2, methods: ["visit"], premises: "mall_store", venue });
    }
    for (const serviceAreas of [emoji.repeat(2000), emoji.repeat(2001), cjk.repeat(1500)]) {
      expectSameAsSchema({ version: 2, methods: ["travel"], serviceAreas });
    }
    // The form saves these; the page must show them.
    expect(
      readPublishedCustomerAccess({
        version: 2,
        methods: ["visit"],
        premises: "mall_store",
        venue: `${emoji.repeat(80)}a`,
      })
    ).not.toBeNull();
  });

  it("rejects sparse method lists as the schema does", () => {
    expectSameAsSchema({ version: 2, methods: [, "online"] });
    expect(readPublishedCustomerAccess({ version: 2, methods: new Array(1) })).toBeNull();
  });

  it("keeps the option list the forms use", () => {
    expect(CUSTOMER_ACCESS_OPTIONS.map((option) => option.value)).toEqual([
      "visit",
      "travel",
      "delivery",
      "online",
    ]);
  });
});
