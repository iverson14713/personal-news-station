export type ProPlanTier = "monthly" | "yearly";

export const PRO_IAP_PRODUCT_IDS: Record<ProPlanTier, string> = {
  monthly: "com.wayne.personalnews.pro.monthly",
  yearly: "com.wayne.personalnews.pro.yearly",
};

export const PRO_PRICING = {
  monthly: {
    price: 60,
    label: "NT$60 / 月",
    shortTitle: "月費",
  },
  yearly: {
    price: 590,
    label: "NT$590 / 年",
    shortTitle: "年費",
    subtitle: "平均 NT$49 / 月，省 18%",
  },
} as const;

export function getProUpgradeButtonLabel(plan: ProPlanTier): string {
  return plan === "monthly" ? "升級月費 Pro" : "升級年費 Pro";
}
