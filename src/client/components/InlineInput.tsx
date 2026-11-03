import { useState } from "react";

interface Props {
  initial?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** A single-line input that submits on Enter and cancels on Escape or blur when empty. */
export function InlineInput({ initial = "", placeholder, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const submit = () => (value.trim() ? onSubmit(value.trim()) : onCancel());
  return (
    <input
      className="inline-input"
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
