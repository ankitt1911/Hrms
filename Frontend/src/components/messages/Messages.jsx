import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCheck, Search, Send, UserPlus } from "lucide-react";
import { motion } from "framer-motion";
import * as api from "../../Services/apiCalling/messageApis";
import usePolling from "../../hooks/usePolling";
import { transitionResult, unwrapCollection } from "../custom/apiBridge";
import { Button, EmptyState, ErrorState, Modal, PageHeading, Skeleton } from "../custom/ui";

const personName = (person) => person?.displayName || [person?.firstName, person?.lastName].filter(Boolean).join(" ") || person?.email || "Colleague";
const initials = (person) => personName(person).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const roleLabel = (person) => person?.designation || (person?.role === "SUPER_ADMIN" ? "Super admin" : "Employee");
const detailLine = (person) => [roleLabel(person), person?.department].filter(Boolean).join(" · ");
const dateLabel = (value) => {
  const date = new Date(value); const today = new Date(); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short" }).format(date);
};
const timeLabel = (value) => value ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
const conversationTime = (value) => {
  if (!value) return "";
  const date = new Date(value); const today = new Date();
  if (date.toDateString() === today.toDateString()) return timeLabel(value);
  const days = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
};

function Avatar({ person, small = false }) {
  return <span className={`chat-avatar${small ? " chat-avatar--small" : ""}`} aria-hidden="true">{initials(person)}</span>;
}

export default function Messages() {
  const [conversations,setConversations]=useState(); const [active,setActive]=useState(); const [messages,setMessages]=useState([]); const [draft,setDraft]=useState(""); const [error,setError]=useState(""); const [sending,setSending]=useState(false); const [partners,setPartners]=useState([]); const [partnerId,setPartnerId]=useState(""); const [partnerModal,setPartnerModal]=useState(false); const [search,setSearch]=useState(""); const [showThread,setShowThread]=useState(false);
  const messageListRef=useRef(null);

  const loadConversations=useCallback(async()=>{
    try {
      const items=unwrapCollection(await api.handleGetConversations()).items;
      setConversations(items);
      setActive(current=>items.find(item=>item._id===current?._id)||items[0]);
      setError("");
      return items;
    } catch(e) { setError(e.message); return []; }
  },[]);

  useEffect(()=>{loadConversations();},[loadConversations]);
  useEffect(()=>{setMessages([]);},[active?._id]);
  useEffect(()=>{if(messageListRef.current)messageListRef.current.scrollTop=messageListRef.current.scrollHeight;},[active?._id,messages.length]);

  const poll=useCallback(async()=>{
    if(!active?._id)return;
    try {
      const since=messages.at(-1)?._id;
      const fresh=unwrapCollection(await api.handleGetNewMessages(active._id,since)).items;
      if(fresh.length){
        setMessages(previous=>{const known=new Set(previous.map(item=>item._id));return [...previous,...fresh.filter(item=>!known.has(item._id))];});
        const latest=fresh.at(-1);
        setConversations(current=>current?.map(item=>item._id===active._id?{...item,lastMessage:latest,lastMessageAt:latest.sentAt,unreadCount:0}:item));
        setActive(current=>current?{...current,lastMessage:latest,lastMessageAt:latest.sentAt,unreadCount:0}:current);
        await api.handleMarkConversationRead(active._id);
      }
    }catch(e){setError(e.message);}
  },[active?._id,messages]);
  usePolling(poll,{intervalMs:7000,enabled:Boolean(active?._id)});

  const send=async(event)=>{
    event.preventDefault(); if(!draft.trim()||!active?._id)return;
    const body=draft.trim(); setSending(true);
    try {
      const sent={...transitionResult(await api.handleSendConversationMessage(active._id,{body})),isMine:true};
      setMessages(previous=>[...previous,sent]); setDraft("");
      setConversations(current=>current?.map(item=>item._id===active._id?{...item,lastMessage:sent,lastMessageAt:sent.sentAt}:item));
      setError("");
    }catch(err){setError(err.message);}finally{setSending(false);}
  };
  const openPartner=async()=>{setSending(true);try{const available=unwrapCollection(await api.handleGetMessagePartners()).items;setPartners(available);setPartnerId(available[0]?._id||available[0]?.id||"");setPartnerModal(true);setError("");}catch(e){setError(e.message);}finally{setSending(false);}};
  const start=async()=>{if(!partnerId)return;setSending(true);try{const result=transitionResult(await api.handleCreateConversation({partnerUserId:partnerId}));const items=await loadConversations();const conversation=items.find(item=>item._id===result._id);if(conversation)setActive(conversation);setPartnerModal(false);setShowThread(true);}catch(e){setError(e.message);}finally{setSending(false);}};
  const chooseConversation=(conversation)=>{setActive(conversation);setShowThread(true);setConversations(current=>current?.map(item=>item._id===conversation._id?{...item,unreadCount:0}:item));};
  const visibleConversations=useMemo(()=>{
    const term=search.trim().toLowerCase(); if(!term)return conversations||[];
    return (conversations||[]).filter(item=>`${personName(item.partner)} ${item.partner?.email||""} ${item.lastMessage?.body||""}`.toLowerCase().includes(term));
  },[conversations,search]);

  return <main className="page-content messages-page">
    <PageHeading meta="Team communication" title="Messages" description="Stay connected with your colleagues in one private workspace." actions={<Button icon={UserPlus} loading={sending&&!partnerModal} onClick={openPartner}>New conversation</Button>}/>
    {error&&<ErrorState message={error}/>} 
    {!conversations?<Skeleton rows={7}/>:<section className={`message-shell surface${showThread?" message-shell--thread":""}`}>
      <aside className="chat-sidebar">
        <header><div><h2>Chats</h2><span>{conversations.length} conversation{conversations.length===1?"":"s"}</span></div><button type="button" className="chat-new-button" onClick={openPartner} aria-label="Start a new conversation"><UserPlus size={18}/></button></header>
        <label className="chat-search"><Search size={16}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations"/></label>
        <div className="chat-conversations">{visibleConversations.length?visibleConversations.map(conversation=>{
          const partner=conversation.partner; const latest=conversation.lastMessage;
          return <button type="button" className={active?._id===conversation._id?"active":""} onClick={()=>chooseConversation(conversation)} key={conversation._id}>
            <Avatar person={partner}/><span className="chat-conversation__content"><span><strong>{personName(partner)}</strong><time>{conversationTime(latest?.sentAt||conversation.lastMessageAt)}</time></span><span><small>{String(latest?.senderId)===String(conversation.currentUserId)&&"You: "}{latest?.body||detailLine(partner)||"Start the conversation"}</small>{conversation.unreadCount>0&&<i>{conversation.unreadCount>99?"99+":conversation.unreadCount}</i>}</span></span>
          </button>;
        }):<EmptyState title={search?"No matching chats":"No conversations"} description={search?"Try another name or message.":"Start a conversation with a colleague."}/>}</div>
      </aside>
      <div className="thread">{!active?<EmptyState title="Choose a conversation" description="Select a colleague to start messaging."/>:<>
        <header className="chat-thread__header"><button type="button" className="icon-button chat-back" onClick={()=>setShowThread(false)} aria-label="Back to conversations"><ArrowLeft size={20}/></button><Avatar person={active.partner} small/><div><strong>{personName(active.partner)}</strong><small>{detailLine(active.partner)||active.partner?.email||"Company colleague"}</small></div><span className="chat-workspace-status"><i/>Company workspace</span></header>
        <div ref={messageListRef} className="message-list" aria-live="polite">{messages.length?messages.map((message,index)=>{
          const mine=Boolean(message.isMine||String(message.senderId)===String(active.currentUserId)); const previous=messages[index-1]; const showDate=!previous||dateLabel(previous.sentAt)!==dateLabel(message.sentAt);
          return <div key={message._id}>{showDate&&<div className="chat-date-divider"><span>{dateLabel(message.sentAt)}</span></div>}<motion.article className={mine?"mine":""} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}><div className="chat-message-author"><div><span>{mine?"You":personName(active.partner)}</span><p>{message.body}</p><time>{timeLabel(message.sentAt)}{mine&&<CheckCheck size={13} aria-label={message.readAt?"Read":"Sent"}/>}</time></div></div></motion.article></div>;
        }):<EmptyState title="No messages yet" description={`Say hello to ${personName(active.partner)} and start the conversation.`}/>}</div>
        <form className="chat-composer" onSubmit={send}><div><textarea aria-label={`Message ${personName(active.partner)}`} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} maxLength={5000} rows={1} placeholder={`Message ${personName(active.partner)}…`}/>{draft.length>0&&<small>{draft.length}/5000</small>}</div><Button icon={Send} loading={sending} disabled={!draft.trim()} aria-label="Send message">Send</Button></form>
      </>}</div>
    </section>}
    <Modal open={partnerModal} onClose={()=>setPartnerModal(false)} title="Start a conversation" description="Choose someone from your company workspace." footer={<><Button variant="secondary" onClick={()=>setPartnerModal(false)}>Cancel</Button><Button loading={sending} disabled={!partnerId} onClick={start}>Start chatting</Button></>}>
      {partners.length?<div className="chat-partner-picker">{partners.map(partner=><button type="button" className={partnerId===(partner._id||partner.id)?"selected":""} onClick={()=>setPartnerId(partner._id||partner.id)} key={partner._id||partner.id}><Avatar person={partner}/><span><strong>{personName(partner)}</strong><small>{detailLine(partner)||partner.email}</small><em>{partner.employeeCode||partner.email}</em></span><i/></button>)}</div>:<EmptyState title="No message partners" description="There are no colleagues available to message."/>}
    </Modal>
  </main>;
}
