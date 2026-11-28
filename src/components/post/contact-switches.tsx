"use client";

import Link from "next/link";
import { maskLocalPhone } from "@/lib/utils/mask";
import { cn } from "@/lib/utils";

export interface ContactSwitchOption {
  /** The form's own method id ("call", "whatsapp", "form", "in_app"). */
  id: string;
  label: string;
  /** Call and WhatsApp use the account's verified number: nothing to type. */
  usesVerifiedNumber?: boolean;
  /** Always on (Market's private enquiry). */
  locked?: boolean;
  /** One short line under the label, for options without a number. */
  hint?: string;
}

/**
 * The one contact block every posting form uses: clear on/off switches, and
 * Call and WhatsApp show the verified number masked ("08• ••• 4567").
 */
export function ContactSwitches({
  id,
  legend = "How people contact you",
  options,
  selected,
  onChange,
  verifiedPhone,
  error,
}: {
  id: string;
  legend?: string;
  options: readonly ContactSwitchOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** The account's verified number; null or empty when it has none. */
  verifiedPhone: string | null | undefined;
  error?: string;
}) {
  const phone = verifiedPhone?.trim() || "";
  return (
    <fieldset id={id} tabIndex={-1} className="space-y-2 rounded-xl focus:outline-none">
      <legend className="text-sm font-semibold text-foreground">{legend} (Required)</legend>
      <ul className="divide-y divide-border/70 rounded-2xl border border-border">
        {options.map((option) => {
          const needsPhone = option.usesVerifiedNumber && !phone;
          const on = option.locked || (!needsPhone && selected.includes(option.id));
          const detailId = `${id}-${option.id}-detail`;
          return (
            <li key={option.id} className="flex min-h-14 items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{option.label}</p>
                <p id={detailId} className="text-xs text-muted-foreground">
                  {option.usesVerifiedNumber ? (
                    phone ? (
                      <>Your verified number {maskLocalPhone(phone)}</>
                    ) : (
                      <>
                        <Link href="/dashboard/profile" className="underline">
                          Verify a number
                        </Link>{" "}
                        to switch this on
                      </>
                    )
                  ) : option.locked ? (
                    "Always on"
                  ) : (
                    option.hint
                  )}
                </p>
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 has-[:disabled]:cursor-not-allowed">
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-7 text-right text-xs font-semibold",
                    on ? "text-brand-green-700 dark:text-brand-gold-300" : "text-muted-foreground"
                  )}
                >
                  {on ? "On" : "Off"}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={option.label}
                  aria-describedby={detailId}
                  checked={on}
                  disabled={option.locked || needsPhone}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected.filter((value) => value !== option.id), option.id]
                        : selected.filter((value) => value !== option.id)
                    )
                  }
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:opacity-60",
                    "after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform motion-reduce:after:transition-none",
                    on
                      ? "bg-brand-green-600 after:translate-x-5 dark:bg-brand-green-500"
                      : "bg-muted-foreground/35"
                  )}
                />
              </label>
            </li>
          );
        })}
      </ul>
      {error ? <p className="inline-form-error">{error}</p> : null}
    </fieldset>
  );
}
