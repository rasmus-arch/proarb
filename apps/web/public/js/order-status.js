// Flödet är Order -> Redo för utlämning -> Utlämnad -> Fakturerad, plus
// Avbruten. DB-värdet för det första steget är fortfarande NEW av
// historiska skäl, men visas som "Order".
export const ORDER_STATUS_LABELS = {
  NEW: "Order",
  READY_FOR_PICKUP: "Redo för utlämning",
  DELIVERED: "Utlämnad",
  INVOICED: "Fakturerad",
  CANCELLED: "Avbruten",
};

export const ORDER_STATUS_COLORS = {
  NEW: "bg-slate-100 text-slate-700",
  READY_FOR_PICKUP: "bg-amber-100 text-amber-700",
  DELIVERED: "bg-green-100 text-green-700",
  INVOICED: "bg-slate-900 text-white",
  CANCELLED: "bg-red-100 text-red-700",
};
