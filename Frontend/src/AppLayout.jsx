import { useCallback, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { useDispatch } from "react-redux";
import AppHeader from "./components/layouts/AppHeader";
import AppSidenav from "./components/layouts/AppSidenav";
import { handleGetNewNotifications } from "./Services/apiCalling/notificationApis";
import { incrementUnreadCount, setUnreadCount } from "./ReduxFeature/notifications/notificationsSlice";
import usePolling from "./hooks/usePolling";

function NotificationSync() {
  const dispatch = useDispatch();
  const cursorRef = useRef(null);
  const initializedRef = useRef(false);

  const poll = useCallback(async () => {
    const payload = await handleGetNewNotifications(cursorRef.current, 30);
    const items = Array.isArray(payload) ? payload : payload?.items || [];
    const unread = items.filter((item) => !item.readAt).length;
    if (initializedRef.current) {
      if (unread) dispatch(incrementUnreadCount(unread));
    } else {
      dispatch(setUnreadCount(unread));
      initializedRef.current = true;
    }
    if (items.length) cursorRef.current = items.at(-1)._id;
  }, [dispatch]);

  usePolling(poll, { intervalMs: 20000, enabled: true });
  return null;
}

export default function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  return <div className="app-shell"><NotificationSync /><AppSidenav open={navOpen} onClose={() => setNavOpen(false)} /><div className="app-frame"><AppHeader onMenu={() => setNavOpen(true)} /><Outlet /></div></div>;
}
