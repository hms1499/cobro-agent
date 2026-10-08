import { Suspense } from "react";
import { AppNav, AppNavLinks } from "./app-nav";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* usePathname can suspend on dynamic routes; the fallback is the same nav without the active mark */}
      <Suspense fallback={<AppNavLinks pathname={null} />}>
        <AppNav />
      </Suspense>
      {/* pb-20 keeps content clear of the fixed mobile bar */}
      <div className="flex flex-1 flex-col pb-20 lg:pb-0">{children}</div>
    </div>
  );
}
