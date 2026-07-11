import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer size-4 shrink-0 rounded border border-border bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-signal data-[state=checked]:border-station-blue data-[state=checked]:bg-station-blue data-[state=checked]:text-white",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center">
        <Check className="size-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
