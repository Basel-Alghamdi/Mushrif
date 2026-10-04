"use client";

import { useEffect, useState } from "react";
import { toNumber } from "./model";

/** A whole-number box that keeps what she typed while storing a number (0 shows as empty). `max` caps percentages at 100. */
export function NumberInput({ id, value, onChange, placeholder = "", max, label }: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  max?: number;
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
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onChange={event => {
        const next = toNumber(event.target.value);
        const capped = max === undefined ? next : Math.min(max, next);
        setText(capped === next ? event.target.value : String(capped));
        onChange(capped);
      }}
    />
  );
}
