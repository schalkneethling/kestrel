import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-station-blue bg-station-blue px-4 py-2 text-white hover:bg-station-blue/90",
        secondary: "border-border bg-card px-4 py-2 text-foreground hover:bg-muted",
        quiet: "border-slate-600 bg-transparent px-4 py-2 text-white hover:bg-white/10",
        danger: "border-red-900/70 bg-transparent px-4 py-2 text-red-200 hover:bg-red-950/40",
        ghost: "border-transparent bg-transparent px-3 py-2 text-muted-foreground hover:bg-muted",
        icon: "size-9 border-transparent bg-transparent p-0 hover:bg-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
