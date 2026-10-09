"use client";

import { useLocal, writeLocal } from "@/lib/hooks";
import { CampaignView } from "@/components/CampaignView";
import { McRankPanel } from "@/components/McRankPanel";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * หน้าเจ้าของ > ผลงาน Mc: อันดับ Mc (ตามช่วง) + แคมเปญ (ทีละรอบ / Mc × แคมเปญ)
 *   แยกออกจากสรุปรายเดือน (ค่าจ้าง) เพราะผลงานดูเป็นช่วง ไม่ผูกกับเดือนค่าจ้าง
 */

const PERF_TAB_KEY = "glory_perf_tab";
const TABS = [["rank", "อันดับ Mc"], ["campaign", "แคมเปญ"]] as const;

export function PerformanceView() {
  const tab = useLocal(PERF_TAB_KEY) === "campaign" ? "campaign" : "rank";
  return (
    <div className="pb-10">
      <ToggleGroup
        type="single" spacing={1} value={tab}
        onValueChange={(v) => { if (v) writeLocal(PERF_TAB_KEY, v); }}
        aria-label="ผลงาน Mc" className="mt-1 rounded-full border bg-card p-1"
      >
        {TABS.map(([id, text]) => (
          <ToggleGroupItem
            key={id} value={id}
            className="rounded-full! px-4 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!"
          >
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {tab === "rank" ? <McRankPanel /> : <CampaignView />}
    </div>
  );
}
