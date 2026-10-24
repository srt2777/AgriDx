interface DividerProps {
  variant?: 'leaf' | 'dots' | 'line';
}

/**
 * 绿色装饰分割元素
 * - leaf: 渐变线 + 中央小叶子
 * - dots: 麦金色圆点
 * - line: 纯渐变细线
 */
export default function SectionDivider({ variant = 'leaf' }: DividerProps) {
  if (variant === 'dots') {
    return (
      <div className="flex items-center justify-center gap-3 py-2" aria-hidden>
        <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
        <span className="h-2 w-2 rounded-full bg-[#c99b3f]/80" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
      </div>
    );
  }

  if (variant === 'line') {
    return (
      <div className="mx-auto h-px w-2/3 bg-gradient-to-r from-transparent via-primary/40 to-transparent" aria-hidden />
    );
  }

  // leaf（默认）：渐变横线 + 中央叶子
  return (
    <div className="relative mx-auto flex w-full max-w-6xl items-center px-4 py-6" aria-hidden>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/50 to-primary/50" />
      <svg viewBox="0 0 24 24" className="mx-4 h-5 w-5 text-primary drop-shadow-sm" fill="currentColor">
        <path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 13 7 17 8z" />
      </svg>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/50 to-primary/50" />
    </div>
  );
}
