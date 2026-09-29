"use client";
import { Children, type ComponentProps, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { FieldHelp } from "./field-help";
import { POST_FIELD_GUIDANCE } from "@/lib/forms/post-guidance";

/** Explicit requirements for posting fields without altering labels elsewhere. */
export function PostLabel({ children, required, ...props }: ComponentProps<typeof Label>) {
  const text = Children.toArray(children)
    .filter((c) => typeof c === "string")
    .join("");
  const isRequired = required ?? text.includes("*");
  const content: ReactNode = Children.map(children, (child) =>
    typeof child === "string" ? child.replace(/\s*\*/g, "") : child
  );
  const alreadyMarked = /\b(optional|required)\b/i.test(text);
  const help = props.htmlFor ? POST_FIELD_GUIDANCE[props.htmlFor] : undefined;
  return (
    <>
      <Label {...props}>
        {content}
        {!alreadyMarked && (
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            ({isRequired ? "Required" : "Optional"})
          </span>
        )}
      </Label>
      {help && <FieldHelp label={text.replace(/\*/g, "").trim()}>{help}</FieldHelp>}
    </>
  );
}
