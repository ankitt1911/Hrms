const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export const isValidObjectId = (value) => typeof value === "string" && OBJECT_ID_PATTERN.test(value);

export const assertObjectId = (value, field = "id") => {
  if (!isValidObjectId(value)) throw new TypeError(`${field} must be a 24-character hexadecimal ObjectId`);
  return value;
};
