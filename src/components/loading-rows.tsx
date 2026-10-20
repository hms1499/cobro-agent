import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";

/** Placeholder rows while a list loads, shaped like `ListRow` so nothing shifts when it arrives. */
export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("common.loading")}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex min-h-11 items-center justify-between gap-4 px-3 py-2.5">
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </span>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
