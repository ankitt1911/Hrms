import { toast } from "react-toastify";

const DEFAULT_OPTIONS = { position: "top-right", autoClose: 4000, closeOnClick: true, pauseOnHover: true };

export const SuccessMessage = (message, options = {}) => toast.success(message || "Completed successfully", { ...DEFAULT_OPTIONS, ...options });
export const ErrorMessage = (message, options = {}) => toast.error(message || "Something went wrong", { ...DEFAULT_OPTIONS, ...options });
export const InfoMessage = (message, options = {}) => toast.info(message, { ...DEFAULT_OPTIONS, ...options });
