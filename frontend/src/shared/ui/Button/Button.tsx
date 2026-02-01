import { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    children: ReactNode;
    icon?: ReactNode;
    iconPosition?: 'left' | 'right';
    fullWidth?: boolean;
}

export function Button({
    variant = 'primary',
    size = 'md',
    children,
    icon,
    iconPosition = 'right',
    fullWidth = false,
    className = '',
    ...props
}: ButtonProps) {
    const classNames = [
        styles.button,
        styles[variant],
        styles[size],
        fullWidth ? styles.fullWidth : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <button className={classNames} {...props}>
            {icon && iconPosition === 'left' && <span className={styles.icon}>{icon}</span>}
            <span>{children}</span>
            {icon && iconPosition === 'right' && <span className={styles.icon}>{icon}</span>}
        </button>
    );
}
