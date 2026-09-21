import { isValidMoneyString } from "./moneyFormat";
import { isValidObjectId } from "./objectId";

export const isRequired = (value) => value !== null && value !== undefined && String(value).trim().length > 0;
export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
export const isValidPassword = (value) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,128}$/.test(String(value || ""));
export const isValidPhone = (value) => /^\+?[1-9]\d{7,14}$/.test(String(value || "").replace(/[\s()-]/g, ""));
export const isValidDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

export const validators = Object.freeze({ required: isRequired, email: isValidEmail, password: isValidPassword, phone: isValidPhone, money: isValidMoneyString, objectId: isValidObjectId, date: isValidDateOnly });

export const validateFields = (values, schema) => Object.entries(schema).reduce((errors, [field, rules]) => {
  const value = values[field];
  for (const rule of rules) {
    if (!rule.validate(value, values)) {
      errors[field] = rule.message;
      break;
    }
  }
  return errors;
}, {});
