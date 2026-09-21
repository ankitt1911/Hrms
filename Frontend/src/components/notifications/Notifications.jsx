import { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { CheckCheck } from "lucide-react";
import * as api from "../../Services/apiCalling/notificationApis";
import { setUnreadCount } from "../../ReduxFeature/notifications/notificationsSlice";
import usePolling from "../../hooks/usePolling";
import { transitionResult, unwrapCollection } from "../custom/apiBridge";
import { Button, DateText, EmptyState, ErrorState, PageHeading, Skeleton } from "../custom/ui";

export default function Notifications() {
  const dispatch=useDispatch();const [items,setItems]=useState();const [error,setError]=useState("");
  const poll=useCallback(async()=>{try{const current=items||[];const since=current.at(-1)?._id;const fresh=unwrapCollection(await api.handleGetNewNotifications(since)).items;setItems(prev=>{const existing=prev||[];const known=new Set(existing.map(n=>n._id));const merged=[...existing,...fresh.filter(n=>!known.has(n._id))];dispatch(setUnreadCount(merged.filter(n=>!n.readAt).length));return merged;});}catch(e){setError(e.message);}},[dispatch,items]);
  usePolling(poll,{intervalMs:20000});
  const read=async(item)=>{try{transitionResult(await api.handleMarkNotificationRead(item._id));setItems(prev=>prev.map(n=>n._id===item._id?{...n,readAt:new Date().toISOString()}:n));dispatch(setUnreadCount(items.filter(n=>!n.readAt&&n._id!==item._id).length));}catch(e){setError(e.message);}};
  const readAll=async()=>{try{transitionResult(await api.handleMarkAllNotificationsRead());setItems(prev=>prev.map(n=>({...n,readAt:n.readAt||new Date().toISOString()})));dispatch(setUnreadCount(0));}catch(e){setError(e.message);}};
  return <main className="page-content"><PageHeading meta="Updates" title="Notifications" description="New items arrive incrementally every twenty seconds while this tab is visible." actions={<Button variant="secondary" icon={CheckCheck} disabled={!items?.some(item=>!item.readAt)} onClick={readAll}>Mark all read</Button>}/>{error&&<ErrorState message={error}/>}<section className="surface notification-list">{!items?<Skeleton rows={5}/>:items.length?items.map(item=><button type="button" key={item._id} className={item.readAt?"read":""} onClick={()=>!item.readAt&&read(item)}><i/><div><strong>{item.title}</strong>{item.body&&<p>{item.body}</p>}<DateText value={item.createdAt} withTime/></div></button>):<EmptyState title="You’re all caught up" description="New HRMS notifications will appear here."/>}</section></main>;
}
