export function formatNumber(val?: number | null, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return Number(val).toFixed(decimals);
}

export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export function getAqiCategory(pm25?: number | null): {
  label: string;
  color: string;
  badgeBg: string;
  textColor: string;
  borderColor: string;
  badgeClass: string;
  description: string;
} {
  if (pm25 === null || pm25 === undefined) {
    return {
      label: "Unknown",
      color: "#94A3B8",
      badgeBg: "bg-slate-800",
      textColor: "text-slate-300",
      borderColor: "border-slate-700",
      badgeClass: "bg-slate-800 text-slate-300 border-slate-700",
      description: "Data not available",
    };
  }

  if (pm25 <= 30) {
    return {
      label: "Good",
      color: "#10B981",
      badgeBg: "bg-emerald-500/15",
      textColor: "text-emerald-400",
      borderColor: "border-emerald-500/30",
      badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      description: "Minimal health impact",
    };
  }
  if (pm25 <= 60) {
    return {
      label: "Satisfactory",
      color: "#34D399",
      badgeBg: "bg-teal-500/15",
      textColor: "text-teal-400",
      borderColor: "border-teal-500/30",
      badgeClass: "bg-teal-500/15 text-teal-400 border-teal-500/30",
      description: "Minor breathing discomfort to sensitive people",
    };
  }
  if (pm25 <= 90) {
    return {
      label: "Moderate",
      color: "#FBBF24",
      badgeBg: "bg-amber-500/15",
      textColor: "text-amber-400",
      borderColor: "border-amber-500/30",
      badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      description: "Breathing discomfort to people with lungs, asthma, and heart diseases",
    };
  }
  if (pm25 <= 120) {
    return {
      label: "Poor",
      color: "#F97316",
      badgeBg: "bg-orange-500/15",
      textColor: "text-orange-400",
      borderColor: "border-orange-500/30",
      badgeClass: "bg-orange-500/15 text-orange-400 border-orange-500/30",
      description: "Breathing discomfort to most people on prolonged exposure",
    };
  }
  if (pm25 <= 250) {
    return {
      label: "Very Poor",
      color: "#EF4444",
      badgeBg: "bg-red-500/15",
      textColor: "text-red-400",
      borderColor: "border-red-500/30",
      badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
      description: "Respiratory illness on prolonged exposure",
    };
  }
  return {
    label: "Severe",
    color: "#991B1B",
    badgeBg: "bg-rose-950/40",
    textColor: "text-rose-400",
    borderColor: "border-rose-700/50",
    badgeClass: "bg-rose-950/40 text-rose-400 border-rose-700/50",
    description: "Affects healthy people and seriously impacts those with existing diseases",
  };
}
