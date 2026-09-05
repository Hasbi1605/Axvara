"use client";

import React from "react";

type Props = {
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
};

function formatThousands(num: number | null | undefined): string {
  if (num === null || num === undefined || Number.isNaN(num)) return "";
  return num.toLocaleString("id-ID");
}

export function MoneyInput({
  value,
  onChange,
  placeholder = "0",
  className = "",
  allowEmpty = false,
}: Props) {
  const [displayValue, setDisplayValue] = React.useState<string>(formatThousands(value));

  React.useEffect(() => {
    setDisplayValue(formatThousands(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Keep only digits
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) {
      setDisplayValue("");
      onChange(allowEmpty ? null : 0);
      return;
    }
    const parsed = parseInt(raw, 10);
    setDisplayValue(parsed.toLocaleString("id-ID"));
    onChange(parsed);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
    />
  );
}
