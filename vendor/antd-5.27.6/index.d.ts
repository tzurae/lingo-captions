import type { ComponentType, CSSProperties, FormEvent, PropsWithChildren, ReactNode } from 'react';

type CommonProps = { className?: string; style?: CSSProperties; children?: ReactNode; role?: string };
export const Alert: ComponentType<CommonProps & { type?: 'success' | 'info' | 'warning' | 'error'; message?: ReactNode; description?: ReactNode; showIcon?: boolean }>;
export const Button: ComponentType<CommonProps & { type?: 'primary' | 'default' | 'text' | 'link'; danger?: boolean; disabled?: boolean; loading?: boolean; size?: 'small' | 'middle' | 'large'; htmlType?: 'button' | 'submit' | 'reset'; onClick?: () => void; 'aria-label'?: string }>;
export const Card: ComponentType<CommonProps & { title?: ReactNode; size?: 'default' | 'small'; bordered?: boolean }>;
export const ColorPicker: ComponentType<{ value?: string; onChangeComplete?: (color: { toHexString(): string }) => void; 'aria-label'?: string }>;
export const Collapse: ComponentType<CommonProps & { items?: Array<{ key: string; label: ReactNode; children: ReactNode }>; defaultActiveKey?: string[] }>;
export const ConfigProvider: ComponentType<PropsWithChildren<{ theme?: Record<string, unknown> }>>;
export const Form: ComponentType<CommonProps & { layout?: 'horizontal' | 'vertical' | 'inline'; onFinish?: () => void; onSubmit?: (event: FormEvent) => void }> & {
  Item: ComponentType<CommonProps & { label?: ReactNode; htmlFor?: string; required?: boolean }>;
};
export const Input: ComponentType<{ id?: string; value?: string; placeholder?: string; onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void; 'aria-label'?: string }> & {
  Password: ComponentType<{ id?: string; value?: string; placeholder?: string; onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void; 'aria-label'?: string }>;
  TextArea: ComponentType<{ id?: string; value?: string; rows?: number; onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void; 'aria-label'?: string }>;
};
export const InputNumber: ComponentType<{ id?: string; value?: number; min?: number; max?: number; onChange?: (value: number | null) => void; 'aria-label'?: string }>;
export const Select: ComponentType<{ id?: string; value?: string; options?: Array<{ value: string; label: ReactNode }>; onChange?: (value: string) => void; 'aria-label'?: string }>;
export const Spin: ComponentType<CommonProps & { spinning?: boolean; tip?: ReactNode; size?: 'small' | 'default' | 'large' }>;
export const Switch: ComponentType<{ id?: string; checked?: boolean; onChange?: (checked: boolean) => void; 'aria-label'?: string }>;
export const Tag: ComponentType<CommonProps & { color?: string }>;
