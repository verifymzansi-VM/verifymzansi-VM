"use client";

import { useEffect } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/hooks/use-translation";
import { locales, localeLabels, type Locale } from "@/lib/i18n";

/**
 * Dropdown language switcher — English / isiZulu / Afrikaans.
 * Persists the choice to localStorage via the i18n Zustand store.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, isLoading } = useTranslation();

  // Load messages for the persisted locale on first mount
  useEffect(() => {
    void setLocale(locale);
  }, [locale, setLocale]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-label="Change language"
          disabled={isLoading}
        >
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">{localeLabels[locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => void setLocale(l as Locale)}
            className={l === locale ? "font-semibold" : undefined}
          >
            {localeLabels[l as Locale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
