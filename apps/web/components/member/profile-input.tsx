"use client";

import type { ProfileField } from "@rasd/schemas";
import { HTMLAttributes, ReactNode } from "react";
import { isFilled } from "./model";
import { ChoiceChips, Field } from "./ui";

type InputMode = HTMLAttributes<HTMLInputElement>["inputMode"];

const KIND_PROPS: Record<string, { type: string; inputMode?: InputMode; dir?: "ltr"; autoComplete?: string }> = {
  phone: { type: "tel", inputMode: "tel", dir: "ltr", autoComplete: "tel" },
  email: { type: "email", inputMode: "email", dir: "ltr", autoComplete: "email" },
  number: { type: "text", inputMode: "numeric" },
  date: { type: "text" }, // one text box: Hijri or Gregorian, no picker, no validation
  text: { type: "text" },
};

/**
 * One profile field, shaped by its kind. Fields with options become tap chips + «أخرى».
 * The server's hint is the placeholder (never repeated under the input). Never validates or blocks.
 */
export function ProfileFieldInput({ field, onChange, essential = false, note, tools }: {
  field: ProfileField;
  onChange: (value: string) => void;
  essential?: boolean;
  note?: ReactNode;
  tools?: ReactNode;
}) {
  const id = `f-${field.id}`;
  const empty = essential && !isFilled(field.value);

  if (field.options?.length) {
    return (
      <div className="m-field-wrap">
        <ChoiceChips id={id} label={field.label} options={field.options} value={field.value} onChange={onChange} empty={empty}
          placeholder={field.hint || "اكتبي هنا"} />
        {note}
      </div>
    );
  }

  const props = KIND_PROPS[field.kind ?? "text"] ?? KIND_PROPS.text;
  return (
    <Field label={field.label} htmlFor={id} empty={empty} note={note} tools={tools}>
      <input id={id} className="input" {...props} value={field.value} placeholder={field.hint} onChange={event => onChange(event.target.value)} />
    </Field>
  );
}
