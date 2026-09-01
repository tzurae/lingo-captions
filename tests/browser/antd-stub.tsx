import type { ReactNode } from 'react';

type LooseProps = {
  children?: ReactNode;
  [key: string]: unknown;
};

function Box({ children, className }: LooseProps) {
  return <div className={typeof className === 'string' ? className : undefined}>{children}</div>;
}

export function Alert({ children, message }: LooseProps) {
  return <div role="alert">{children ?? (message as ReactNode)}</div>;
}

export function Button({
  children,
  disabled,
  onClick,
}: LooseProps & { disabled?: boolean; onClick?: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick}>
    {children}
  </button>;
}

export const Card = Box;
export const Collapse = Box;
export const ColorPicker = Box;
export const Input = Object.assign(Box, { TextArea: Box });
export const InputNumber = Box;
export const Select = Box;
export function Spin() {
  return <span aria-hidden="true">Loading</span>;
}
export const Switch = Box;
export const Tag = Box;
export const Form = Object.assign(Box, {
  Item: Box,
  useForm: () => [{}],
  useWatch: () => undefined,
});
