import { MarkAllNotificationsReadApi, MarkNotificationReadApi, NotificationsApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleGetNotifications = (params = {}) => toData(NotificationsApi(params));
export const handleGetNewNotifications = (since, limit = 30) => handleGetNotifications({ ...(since ? { since } : {}), limit });
export const handleMarkNotificationRead = (id) => toResult(MarkNotificationReadApi(id));
export const handleMarkAllNotificationsRead = () => toResult(MarkAllNotificationsReadApi());
