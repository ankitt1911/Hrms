import { createSlice } from "@reduxjs/toolkit";

const notificationsSlice = createSlice({
  name: "notifications",
  initialState: { unreadCount: 0 },
  reducers: {
    setUnreadCount: (state, { payload }) => { state.unreadCount = Math.max(0, Number(payload) || 0); },
    incrementUnreadCount: (state, { payload = 1 }) => { state.unreadCount += Math.max(0, Number(payload) || 0); },
    decrementUnreadCount: (state, { payload = 1 }) => { state.unreadCount = Math.max(0, state.unreadCount - Math.max(0, Number(payload) || 0)); },
    clearUnreadCount: (state) => { state.unreadCount = 0; },
  },
});

export const { setUnreadCount, incrementUnreadCount, decrementUnreadCount, clearUnreadCount } = notificationsSlice.actions;
export const selectUnreadCount = (state) => state.notifications.unreadCount;
export default notificationsSlice.reducer;
