"use client";

import { useEffect, useState } from "react";
import { toNumber } from "./model";

/** Numeric text box that keeps what she typed (e.g. "85.") while storing a number. 0 shows as empty. */
export function NumberInput({ id, value, onChange, placeholder = "", decimal = false, label }: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  decimal?: boolean;
  label?: string;
}) {
  const [text, setText] = useState(value ? String(value) : "");

  // Follow changes that come from elsewhere (another device, رئيسة النطاق).
  useEffect(() => {
    setText(current => (toNumber(current) === (Number(value) || 0) ? current : value ? String(value) : ""));
  }, [value]);

  return (
    <input
      id={id}
      className="input m-num"
      inputMode={decimal ? "decimal" : "numeric"}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onChange={event => {
        setText(event.target.value);
        onChange(toNumber(event.target.value));
      }}
    />
  );
}
