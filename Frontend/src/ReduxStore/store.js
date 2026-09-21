import { configureStore } from "@reduxjs/toolkit";
import authReducer from "../ReduxFeature/Authenticate/authSlice";
import notificationsReducer from "../ReduxFeature/notifications/notificationsSlice";

export const store = configureStore({
  reducer: { auth: authReducer, notifications: notificationsReducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: true }),
  devTools: import.meta.env.DEV,
});

export default store;
