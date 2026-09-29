"use client";
import { type ComponentProps } from "react";
import { FieldHelp } from "./field-help";
import { POST_FIELD_GUIDANCE, POST_OPTION_GUIDANCE } from "@/lib/forms/post-guidance";

/** Keeps field-specific instructions next to a native, keyboard-accessible select. */
export function PostSelect(props: ComponentProps<"select">) {
  const label = String(props["aria-label"] || props.name || props.id || "this selection");
  const guidance = POST_FIELD_GUIDANCE[props.id ?? ""];
  const selected =
    typeof props.value === "string"
      ? POST_OPTION_GUIDANCE[props.id ?? ""]?.[props.value]
      : undefined;
  const selectedId = props.id ? `${props.id}-selected-help` : undefined;
  return (
    <>
      <select
        {...props}
        aria-describedby={
          [props["aria-describedby"], selected ? selectedId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {selected && (
        <p id={selectedId} className="text-sm text-muted-foreground">
          {selected}
        </p>
      )}
      {!guidance && (
        <FieldHelp label={label}>
          {props.multiple
            ? "Choose all the options that apply."
            : "Choose one option that matches your listing."}{" "}
          {props.required
            ? "An answer is required before continuing."
            : "If this field is marked Optional, leave it blank when it does not apply or you are unsure."}{" "}
          You can change your choice before submitting. Describe any details or exceptions in your
          listing description.
        </FieldHelp>
      )}
    </>
  );
}
