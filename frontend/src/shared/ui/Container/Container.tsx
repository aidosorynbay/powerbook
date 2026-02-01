import { HTMLAttributes, ReactNode } from 'react';
import styles from './Container.module.css';

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Container({ 
  children, 
  size = 'lg',
  className = '', 
  ...props 
}: ContainerProps) {
  const classNames = [
    styles.container,
    styles[size],
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classNames} {...props}>
      {children}
    </div>
  );
}
