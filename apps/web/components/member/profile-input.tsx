"use client";

import { HTMLAttributes, ReactNode } from "react";
import type { ProfileField } from "../../lib/types";
import { isFilled, lookOf } from "./model";
import { ChoiceChips, Field } from "./ui";

type InputMode = HTMLAttributes<HTMLInputElement>["inputMode"];

const KIND_PROPS: Record<string, { type: string; inputMode?: InputMode; dir?: "ltr"; autoComplete?: string }> = {
  tel: { type: "tel", inputMode: "tel", dir: "ltr", autoComplete: "tel" },
  email: { type: "email", inputMode: "email", dir: "ltr", autoComplete: "email" },
  numeric: { type: "text", inputMode: "numeric" },
  date: { type: "text" }, // one text box: Hijri or Gregorian, no picker, no validation
  text: { type: "text" },
};

/**
 * One profile field, shaped by its key. Fields with options become tap chips + «أخرى».
 * The example is the placeholder (never repeated under the input). Never validates or blocks.
 */
export function ProfileFieldInput({ field, onChange, empty = false, note, tools }: {
  field: ProfileField;
  onChange: (value: string, typed?: boolean) => void;
  /** Soft amber border while empty (the field counts toward completion). */
  empty?: boolean;
  note?: ReactNode;
  tools?: ReactNode;
}) {
  const id = `f-${field.id}`;
  const look = lookOf(field);
  const isEmpty = empty && !isFilled(field.value);

  if (look.options?.length) {
    return (
      <div className="m-field-wrap">
        <ChoiceChips id={id} label={field.label} options={look.options} value={field.value} onChange={onChange} empty={isEmpty}
          placeholder={look.placeholder ?? "اكتبي هنا"} />
        {note}
      </div>
    );
  }

  const props = KIND_PROPS[look.kind ?? "text"];
  return (
    <Field label={field.label} htmlFor={id} empty={isEmpty} note={note} tools={tools}>
      <input id={id} className="input" {...props} value={field.value} placeholder={look.placeholder}
        onChange={event => onChange(event.target.value, true)} />
    </Field>
  );
}
