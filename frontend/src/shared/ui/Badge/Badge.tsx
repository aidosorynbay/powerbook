import { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeVariant = 'default' | 'success' | 'accent' | 'outline';
export type BadgeSize = 'sm' | 'md';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    variant?: BadgeVariant;
    size?: BadgeSize;
    children: ReactNode;
}

export function Badge({
    variant = 'default',
    size = 'md',
    children,
    className = '',
    ...props
}: BadgeProps) {
    const classNames = [
        styles.badge,
        styles[variant],
        styles[size],
        className,
    ].filter(Boolean).join(' ');

    return (
        <span className={classNames} {...props}>
            {children}
        </span>
    );
}
