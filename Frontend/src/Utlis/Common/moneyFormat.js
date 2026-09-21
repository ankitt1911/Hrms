export const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export const isValidMoneyString = (value) => typeof value === "string" && MONEY_PATTERN.test(value.trim());

export const normalizeMoneyString = (value) => {
  const text = String(value ?? "").trim();
  if (!isValidMoneyString(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${whole.replace(/^0+(?=\d)/, "") || "0"}.${fraction.padEnd(2, "0")}`;
};

export const formatMoney = (decimalString, currency = "INR", locale = "en-IN") => {
  if (decimalString === null || decimalString === undefined || decimalString === "") return "—";
  const text = String(decimalString);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return "—";
  const numericValue = Number(text);
  if (!Number.isFinite(numericValue)) return text;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numericValue);
  } catch {
    return text;
  }
};
