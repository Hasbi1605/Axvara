import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";

export function CommunityBar() {
  const locale = useDisplayLocale();
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 -mt-1 mb-2">
      <div className="flex flex-row gap-2 sm:gap-3">
        <CrossServicePromo current="market" locale={locale} />

        <CrossServicePromo current="market" target="games" locale={locale} />
      </div>
    </div>
  );
}
