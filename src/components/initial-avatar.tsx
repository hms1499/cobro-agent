import { initials } from "@/lib/ui/initials";

const SIZES = { sm: "size-8 text-xs", md: "size-10 text-sm" } as const;

/** A client's or the freelancer's initials in a circle; the name is always written next to it, so it is decorative. */
export function InitialAvatar({ name, size = "sm" }: { name: string; size?: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-tint/45 font-semibold text-primary ${SIZES[size]}`}
    >
      {initials(name)}
    </span>
  );
}
