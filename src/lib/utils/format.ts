export function fmtRp(v: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Math.round(v));
}

export function fmtNum(v: number, digits = 0): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function fmtM(v: number): string {
  return v.toFixed(2).replace(".", ",");
}
