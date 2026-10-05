/** The رَصد logo (public/logo.svg) on its tile; the tile's size and look come from `className` (lg-mark, m-brand-mark, d-brand-tile). */
export function BrandMark({ className }: { className: string }) {
  return <span className={className} aria-hidden><img src="/logo.svg" alt="" /></span>;
}
