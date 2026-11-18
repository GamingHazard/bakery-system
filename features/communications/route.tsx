"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  ArrowUpRight,
  Check,
  CircleAlert,
  Mail,
  Megaphone,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Send,
  StickyNote,
  UsersRound,
} from "lucide-react";
import { hasAnyDepartmentRole } from "@/lib/authorization";
import {
  addWebsiteConversationNote,
  createNewsletterCampaign,
  deleteNewsletterSubscriber,
  getWebsiteConversation,
  listMessageAssignees,
  listNewsletterCampaigns,
  listNewsletterSubscribers,
  listWebsiteConversations,
  previewNewsletterCampaign,
  retryWebsiteConversationReply,
  sendNewsletterCampaign,
  sendNewsletterCampaignTest,
  sendWebsiteConversationReply,
  updateNewsletterCampaign,
  updateNewsletterSubscriberStatus,
  updateWebsiteConversation,
  type NewsletterCampaign,
  type NewsletterCampaignBlock,
  type NewsletterSubscriber,
  type WebsiteConversation,
  type WebsiteConversationStatus,
} from "@/lib/user-api";
import { useWorkspace } from "@/features/workspace/workspace-context";

type SectionTab = "messages" | "newsletter";
type CampaignForm = {
  name: string;
  subject: string;
  previewText: string;
  intro: string;
  blocks: NewsletterCampaignBlock[];
};

const EMPTY_CAMPAIGN: CampaignForm = {
  name: "",
  subject: "",
  previewText: "",
  intro: "",
  blocks: [{ type: "paragraph", text: "" }],
};
const COMMUNICATIONS_PAGE_SIZE = 50;

const STATUS_LABELS: Record<WebsiteConversationStatus, string> = {
  new: "New",
  in_progress: "In progress",
  awaiting_customer: "Awaiting customer",
  quoted: "Quoted",
  converted_to_order: "Converted to order",
  closed: "Closed",
};

function recordId(record: { _id: string; id?: string }) {
  return record.id || record._id;
}

function assignedUserId(conversation: WebsiteConversation) {
  return conversation.assignedTo?._id || conversation.assignedTo?.id || "";
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function messageCategory(type: WebsiteConversation["type"]) {
  if (type === "custom_order") return "Custom order";
  if (type === "sales") return "Sales";
  return "Contact";
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function PaginationControls({
  page,
  total,
  onPageChange,
  label,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
  label: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / COMMUNICATIONS_PAGE_SIZE));
  if (pageCount <= 1) return null;

  return (
    <nav aria-label={`${label} pagination`} className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
      <p className="text-xs text-slate-500">
        Showing {(page - 1) * COMMUNICATIONS_PAGE_SIZE + 1}–{Math.min(page * COMMUNICATIONS_PAGE_SIZE, total)} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
        <span className="text-xs text-slate-600">Page {page} of {pageCount}</span>
        <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
      </div>
    </nav>
  );
}

export default function WebsiteCommunicationsRoute() {
  const { currentUser } = useWorkspace();
  const canManageMessages = hasAnyDepartmentRole(currentUser.roles, [
    "Admin",
    "General Manager",
    "Sales Manager",
    "Marketing Manager",
  ]);
  const canManageNewsletter = hasAnyDepartmentRole(currentUser.roles, [
    "Admin",
    "General Manager",
    "Marketing Manager",
  ]);
  const [tab, setTab] = useState<SectionTab>("messages");
  const [error, setError] = useState("");

  if (!canManageMessages && !canManageNewsletter) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-xl font-semibold text-slate-900">Website Communications</h1>
        <p className="mt-2 text-sm text-slate-600">You do not have access to this workspace.</p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Overview</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Website Communications</h1>
          <p className="mt-1 text-sm text-slate-600">Manage customer conversations and consent-based bakery email updates.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Communication area">
          {canManageMessages && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "messages"}
              onClick={() => { setTab("messages"); setError(""); }}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${tab === "messages" ? "bg-violet-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <MessageSquareText size={16} /> Messages
            </button>
          )}
          {canManageNewsletter && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "newsletter"}
              onClick={() => { setTab("newsletter"); setError(""); }}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${tab === "newsletter" ? "bg-violet-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Megaphone size={16} /> Newsletter
            </button>
          )}
        </div>
      </header>
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <CircleAlert className="mt-0.5 shrink-0" size={17} /> <span>{error}</span>
        </div>
      )}
      {tab === "messages" && canManageMessages
        ? <MessagesWorkspace onError={setError} />
        : tab === "newsletter" && canManageNewsletter
          ? <NewsletterWorkspace onError={setError} />
          : null}
    </div>
  );
}

function MessagesWorkspace({ onError }: { onError: (message: string) => void }) {
  const [items, setItems] = useState<WebsiteConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<WebsiteConversation | null>(null);
  const [assignees, setAssignees] = useState<Array<{ _id: string; name: string; email: string }>>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [composer, setComposer] = useState<"reply" | "note">("reply");
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listWebsiteConversations({
      page,
      limit: COMMUNICATIONS_PAGE_SIZE,
      search,
      status: statusFilter,
      type: typeFilter,
    })
      .then((result) => {
        if (!active) return;
        const nextPageCount = Math.max(1, Math.ceil(result.total / COMMUNICATIONS_PAGE_SIZE));
        if (page > nextPageCount) {
          setPage(nextPageCount);
          return;
        }
        const nextItems = result.items;
        setTotal(result.total);
        setItems(nextItems);
        setSelectedId((current) =>
          current && nextItems.some((item) => recordId(item) === current)
            ? current
            : nextItems[0] ? recordId(nextItems[0]) : "",
        );
      })
      .catch((reason: unknown) => {
        if (active) onError(errorText(reason, "Could not load website messages."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onError, page, refresh, search, statusFilter, typeFilter]);

  useEffect(() => {
    let active = true;
    listMessageAssignees()
      .then(({ items: nextItems }) => {
        if (active) setAssignees(nextItems);
      })
      .catch((reason: unknown) => {
        if (active) onError(errorText(reason, "Could not load message assignees."));
      });
    return () => { active = false; };
  }, [onError]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let active = true;
    getWebsiteConversation(selectedId)
      .then(({ conversation }) => {
        if (active) {
          setSelected(conversation);
          setItems((current) => current.map((item) =>
            recordId(item) === selectedId ? { ...item, unread: false } : item,
          ));
        }
      })
      .catch((reason: unknown) => {
        if (active) onError(errorText(reason, "Could not load this conversation."));
      });
    return () => { active = false; };
  }, [onError, selectedId, refresh]);

  const openCount = useMemo(
    () => items.filter((item) => !["closed", "converted_to_order"].includes(item.status)).length,
    [items],
  );

  async function saveConversation(update: { status?: WebsiteConversationStatus; assignedTo?: string | null }) {
    if (!selected) return;
    try {
      onError("");
      const { conversation } = await updateWebsiteConversation(recordId(selected), update);
      setSelected(conversation);
      setItems((current) => current.map((item) =>
        recordId(item) === recordId(conversation) ? { ...item, ...conversation } : item,
      ));
    } catch (reason) {
      onError(errorText(reason, "Could not update the conversation."));
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !messageText.trim()) return;
    setSending(true);
    onError("");
    try {
      const { conversation } = composer === "note"
        ? await addWebsiteConversationNote(recordId(selected), messageText.trim())
        : await sendWebsiteConversationReply(recordId(selected), messageText.trim());
      setSelected(conversation);
      setItems((current) => current.map((item) =>
        recordId(item) === recordId(conversation) ? { ...item, ...conversation } : item,
      ));
      setMessageText("");
      setRefresh((value) => value + 1);
    } catch (reason) {
      onError(errorText(reason, "The message could not be saved or sent."));
      setRefresh((value) => value + 1);
    } finally {
      setSending(false);
    }
  }

  async function retryReply(messageId: string) {
    if (!selected) return;
    try {
      onError("");
      const { conversation } = await retryWebsiteConversationReply(recordId(selected), messageId);
      setSelected(conversation);
      setRefresh((value) => value + 1);
    } catch (reason) {
      onError(errorText(reason, "The email reply could not be retried."));
      setRefresh((value) => value + 1);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-900">Customer inbox</h2>
          <p className="text-xs text-slate-500">{openCount} open on this page · {total} total matching</p>
        </div>
        <button type="button" onClick={() => setRefresh((value) => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <div className="grid min-h-[650px] lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[310px_minmax(0,1fr)_250px]">
        <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r">
          <form
            className="space-y-2 border-b border-slate-200 p-3"
            onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }}
          >
            <label className="relative block">
              <span className="sr-only">Search conversations</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search name, email or reference" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Filter by status" value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }} className="min-w-0 rounded-lg border border-slate-200 px-2 py-2 text-xs">
                <option value="all">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select aria-label="Filter by type" value={typeFilter} onChange={(event) => { setPage(1); setTypeFilter(event.target.value); }} className="min-w-0 rounded-lg border border-slate-200 px-2 py-2 text-xs">
                <option value="all">All types</option>
                <option value="contact">Contact</option>
                <option value="custom_order">Custom order</option>
                <option value="sales">Sales</option>
              </select>
            </div>
          </form>
          <div className="max-h-[600px] overflow-y-auto">
            {loading && <p className="p-5 text-sm text-slate-500">Loading conversations…</p>}
            {!loading && !items.length && <p className="p-5 text-sm text-slate-500">No conversations match these filters.</p>}
            {items.map((item) => {
              const id = recordId(item);
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => { setSelectedId(id); setComposer("reply"); setMessageText(""); }}
                  className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selectedId === id ? "bg-violet-50/70" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{item.customerName || item.customerEmail}</span>
                    {item.unread && <span className="size-2 shrink-0 rounded-full bg-violet-600" aria-label="Unread" />}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate">{messageCategory(item.type)} · {item.reference}</span>
                    <span className="shrink-0">{displayDate(item.lastMessageAt)}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-600">{item.lastMessagePreview || item.subject}</span>
                </button>
              );
            })}
          </div>
          <PaginationControls page={page} total={total} onPageChange={setPage} label="Messages" />
        </aside>

        <div className="flex min-w-0 flex-col">
          {!selected ? (
            <div className="grid flex-1 place-items-center p-8 text-center text-sm text-slate-500">
              <div><Mail className="mx-auto mb-3 text-slate-400" size={28} /><p>Select a conversation to view its history.</p></div>
            </div>
          ) : (
            <>
              <header className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">{messageCategory(selected.type)} · {selected.reference}</p>
                    <h3 className="mt-1 truncate text-lg font-semibold text-slate-950">{selected.subject || "Website message"}</h3>
                    <p className="text-sm text-slate-600">{selected.customerName || "Website customer"} · <a className="text-violet-700 underline" href={`mailto:${selected.customerEmail}`}>{selected.customerEmail}</a></p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{selected.channel === "email" ? "Email" : "Website form"}</span>
                </div>
                {selected.customOrder && (
                  <div className="mt-4 grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 sm:grid-cols-2">
                    <p><strong>Occasion:</strong> {selected.customOrder.orderType || "Not specified"}</p>
                    <p><strong>Products:</strong> {selected.customOrder.requestedProducts || "Not specified"}</p>
                    <p><strong>Quantity:</strong> {selected.customOrder.estimatedQuantity ?? "Not specified"}</p>
                    <p><strong>Preferred date:</strong> {selected.customOrder.preferredDate || "Not specified"}</p>
                    <p><strong>Fulfillment:</strong> {selected.customOrder.fulfillment || "Not specified"}</p>
                    <p className="sm:col-span-2"><strong>Requirements:</strong> {selected.customOrder.requirements || "None provided"}</p>
                    <p className="font-medium sm:col-span-2">Enquiry only. It has not been converted to a confirmed order.</p>
                  </div>
                )}
              </header>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 px-4 py-4">
                {(selected.messages || []).map((message) => (
                  <article key={message._id} className={`max-w-[92%] rounded-xl border p-3 shadow-sm ${message.direction === "outbound" ? "ml-auto border-violet-100 bg-violet-50" : message.direction === "internal" ? "mx-auto border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
                    <header className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="font-semibold uppercase tracking-wide">{message.direction === "internal" ? "Internal note" : message.direction === "outbound" ? "Sent by bakery" : "Received"}</span>
                      <time dateTime={message.createdAt}>{displayDate(message.createdAt)}</time>
                    </header>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{message.text}</p>
                    {message.direction === "outbound" && message.deliveryStatus === "failed" && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        <span>Email failed: {message.deliveryError || "Delivery was not confirmed."}</span>
                        <button type="button" onClick={() => void retryReply(message._id)} className="font-semibold underline">Retry</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <form className="border-t border-slate-200 bg-white p-4" onSubmit={submitMessage}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex rounded-lg bg-slate-100 p-1">
                    <button type="button" onClick={() => setComposer("reply")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${composer === "reply" ? "bg-white text-violet-800 shadow-sm" : "text-slate-600"}`}><Send size={13} className="mr-1 inline" />Email reply</button>
                    <button type="button" onClick={() => setComposer("note")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${composer === "note" ? "bg-white text-amber-800 shadow-sm" : "text-slate-600"}`}><StickyNote size={13} className="mr-1 inline" />Internal note</button>
                  </div>
                  <span className="text-[11px] text-slate-500">{composer === "reply" ? `From the ${selected.type === "custom_order" ? "orders" : selected.type === "sales" ? "sales" : "info"} inbox` : "Visible only to staff"}</span>
                </div>
                <label className="sr-only" htmlFor="conversation-reply">{composer === "note" ? "Internal note" : "Email reply"}</label>
                <textarea id="conversation-reply" required maxLength={20000} rows={4} value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder={composer === "note" ? "Add a private note for the team…" : "Write a thoughtful reply…"} className="w-full resize-y rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
                <div className="mt-2 flex justify-end">
                  <button disabled={sending || !messageText.trim()} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
                    {sending ? "Saving…" : composer === "note" ? "Add note" : "Send reply"} <ArrowUpRight size={15} />
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        <aside className="space-y-4 border-t border-slate-200 bg-slate-50/50 p-4 xl:border-l xl:border-t-0">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Conversation details</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div><dt className="text-xs text-slate-500">Status</dt><dd className="mt-1"><label className="sr-only" htmlFor="conversation-status">Status</label><select id="conversation-status" disabled={!selected} value={selected?.status || "new"} onChange={(event) => void saveConversation({ status: event.target.value as WebsiteConversationStatus })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></dd></div>
              <div><dt className="text-xs text-slate-500">Assigned to</dt><dd className="mt-1"><label className="sr-only" htmlFor="conversation-assignee">Assigned to</label><select id="conversation-assignee" disabled={!selected} value={selected ? assignedUserId(selected) : ""} onChange={(event) => void saveConversation({ assignedTo: event.target.value || null })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"><option value="">Unassigned</option>{assignees.map((user) => <option key={user._id} value={user._id}>{user.name}</option>)}</select></dd></div>
              <div><dt className="text-xs text-slate-500">Phone</dt><dd className="mt-1 break-words text-xs text-slate-800">{selected?.customerPhone || "Not provided"}</dd></div>
              <div><dt className="text-xs text-slate-500">Received</dt><dd className="mt-1 text-xs text-slate-800">{selected ? displayDate(selected.lastMessageAt) : "—"}</dd></div>
              {selected?.channel === "email" && <div><dt className="text-xs text-slate-500">Reply address</dt><dd className="mt-1 break-all text-xs text-slate-800">{selected.recipientAddress || "Configured by message type"}</dd></div>}
            </dl>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800"><Archive size={14} /> Order boundary</div>
            <p className="mt-2 text-xs leading-5 text-slate-600">Website enquiries stay in this inbox. Convert a custom-order enquiry only through the approved bakery order workflow after confirming details and availability.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function NewsletterWorkspace({ onError }: { onError: (message: string) => void }) {
  const [section, setSection] = useState<"subscribers" | "campaigns">("subscribers");
  const [eligibleCount, setEligibleCount] = useState(0);
  useEffect(() => {
    let active = true;
    listNewsletterSubscribers({ limit: 1 })
      .then((result) => { if (active) setEligibleCount(result.eligibleCount); })
      .catch((reason: unknown) => {
        if (active) onError(errorText(reason, "Could not load the eligible audience count."));
      });
    return () => { active = false; };
  }, [onError]);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-semibold text-slate-900">Newsletter management</h2>
          <p className="text-sm text-slate-600">Only verified, active subscribers synchronized with Resend are included in broadcasts.</p>
        </div>
        <div className="flex rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Newsletter section">
          <button type="button" role="tab" aria-selected={section === "subscribers"} onClick={() => setSection("subscribers")} className={`rounded-md px-3 py-2 text-sm ${section === "subscribers" ? "bg-white font-semibold text-violet-800 shadow-sm" : "text-slate-600"}`}><UsersRound className="mr-1 inline" size={15} />Subscribers</button>
          <button type="button" role="tab" aria-selected={section === "campaigns"} onClick={() => setSection("campaigns")} className={`rounded-md px-3 py-2 text-sm ${section === "campaigns" ? "bg-white font-semibold text-violet-800 shadow-sm" : "text-slate-600"}`}><Megaphone className="mr-1 inline" size={15} />Campaigns</button>
        </div>
      </div>
      {section === "subscribers"
        ? <SubscribersPanel onError={onError} eligibleCount={eligibleCount} setEligibleCount={setEligibleCount} />
        : <CampaignsPanel onError={onError} eligibleCount={eligibleCount} />}
    </section>
  );
}

function SubscribersPanel({
  onError,
  eligibleCount,
  setEligibleCount,
}: {
  onError: (message: string) => void;
  eligibleCount: number;
  setEligibleCount: (count: number) => void;
}) {
  const [items, setItems] = useState<NewsletterSubscriber[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [workingId, setWorkingId] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    listNewsletterSubscribers({ page, limit: COMMUNICATIONS_PAGE_SIZE, status, search })
      .then((result) => {
        if (!active) return;
        const nextPageCount = Math.max(1, Math.ceil(result.total / COMMUNICATIONS_PAGE_SIZE));
        if (page > nextPageCount) {
          setPage(nextPageCount);
          return;
        }
        setItems(result.items);
        setTotal(result.total);
        setEligibleCount(result.eligibleCount);
      })
      .catch((reason: unknown) => {
        if (active) onError(errorText(reason, "Could not load newsletter subscribers."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onError, page, refresh, search, setEligibleCount, status]);

  async function changeStatus(item: NewsletterSubscriber, next: "active" | "suspended" | "unsubscribed") {
    setWorkingId(recordId(item));
    try {
      onError("");
      const { subscriber } = await updateNewsletterSubscriberStatus(recordId(item), next);
      setItems((current) => current.map((row) =>
        recordId(row) === recordId(subscriber) ? subscriber : row,
      ));
      setRefresh((value) => value + 1);
    } catch (reason) {
      onError(errorText(reason, "Could not update the subscriber."));
    } finally {
      setWorkingId("");
    }
  }

  async function removeSubscriber(item: NewsletterSubscriber) {
    const confirmedEmail = window.prompt(`To permanently delete this subscriber from the bakery database, type:\n${item.email}`);
    if (confirmedEmail === null) return;
    setWorkingId(recordId(item));
    try {
      onError("");
      await deleteNewsletterSubscriber(recordId(item), confirmedEmail);
      setItems((current) => current.filter((row) => recordId(row) !== recordId(item)));
      setRefresh((value) => value + 1);
    } catch (reason) {
      onError(errorText(reason, "Could not delete the subscriber."));
    } finally {
      setWorkingId("");
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div><h3 className="font-semibold text-slate-900">Subscribers</h3><p className="text-xs text-slate-500">{eligibleCount} eligible for a broadcast</p></div>
        <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }}>
          <label className="relative"><span className="sr-only">Search email</span><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search email" className="w-56 rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400" /></label>
          <select aria-label="Filter subscribers by status" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="pending_verification">Pending verification</option><option value="suspended">Suspended</option><option value="unsubscribed">Unsubscribed</option><option value="suppressed">Suppressed</option></select>
          <button type="button" onClick={() => setRefresh((value) => value + 1)} aria-label="Refresh subscriber list" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><RefreshCw size={16} /></button>
        </form>
      </div>
      {loading ? <p className="p-6 text-sm text-slate-500">Loading subscribers…</p> : !items.length ? <p className="p-6 text-sm text-slate-500">No subscribers match this view.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Verification</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Provider sync</th><th className="px-4 py-3">Last campaign</th><th className="px-4 py-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={recordId(item)} className="align-top">
                  <td className="px-4 py-3"><span className="font-medium text-slate-900">{item.email}</span><span className="mt-1 block text-xs text-slate-500">Joined {displayDate(item.createdAt)}</span></td>
                  <td className="px-4 py-3">{item.consent?.verifiedAt ? <span className="inline-flex items-center gap-1 text-emerald-700"><Check size={14} />Verified</span> : <span className="text-amber-700">Not verified</span>}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.status === "active" ? "bg-emerald-50 text-emerald-700" : item.status === "suppressed" || item.status === "unsubscribed" ? "bg-slate-100 text-slate-700" : item.status === "suspended" ? "bg-amber-50 text-amber-800" : "bg-violet-50 text-violet-700"}`}>{item.status.replaceAll("_", " ")}</span></td>
                  <td className="px-4 py-3"><span className={item.providerSyncStatus === "synced" ? "text-emerald-700" : "text-rose-700"}>{item.providerSyncStatus}</span>{item.providerSyncError && <span className="mt-1 block max-w-48 text-xs text-rose-700">{item.providerSyncError}</span>}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{item.lastCampaignAt ? displayDate(item.lastCampaignAt) : "Never"}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                    {item.status === "active" && <button disabled={workingId === recordId(item)} onClick={() => void changeStatus(item, "suspended")} className="rounded-md border border-amber-200 px-2 py-1 text-xs font-medium text-amber-800 disabled:opacity-50">Suspend</button>}
                    {item.status === "suspended" && <button disabled={workingId === recordId(item)} onClick={() => void changeStatus(item, "active")} className="rounded-md border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-800 disabled:opacity-50">Reactivate</button>}
                    {item.status === "active" && <button disabled={workingId === recordId(item)} onClick={() => { if (window.confirm(`Unsubscribe ${item.email} from future marketing emails?`)) void changeStatus(item, "unsubscribed"); }} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50">Unsubscribe</button>}
                    <button disabled={workingId === recordId(item)} onClick={() => void removeSubscriber(item)} className="rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 disabled:opacity-50">Delete</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && <PaginationControls page={page} total={total} onPageChange={setPage} label="Subscribers" />}
    </section>
  );
}

function CampaignsPanel({ onError, eligibleCount }: { onError: (message: string) => void; eligibleCount: number }) {
  const [campaigns, setCampaigns] = useState<NewsletterCampaign[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<CampaignForm>(EMPTY_CAMPAIGN);
  const [preview, setPreview] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    listNewsletterCampaigns()
      .then(({ items }) => {
        if (!active) return;
        setCampaigns(items);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (active) {
          onError(errorText(reason, "Could not load campaigns."));
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [onError, refresh]);

  const selected = campaigns.find((campaign) => recordId(campaign) === selectedId);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      name: selected.name,
      subject: selected.subject,
      previewText: selected.previewText,
      intro: selected.intro,
      blocks: selected.blocks,
    });
    setPreview("");
  }, [selectedId]);

  function updateBlock(index: number, patch: Partial<NewsletterCampaignBlock>) {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, ...patch } as NewsletterCampaignBlock : block,
      ),
    }));
  }

  function addBlock(type: NewsletterCampaignBlock["type"]) {
    const block: NewsletterCampaignBlock = type === "button"
      ? { type, label: "", url: "" }
      : type === "image"
        ? { type, url: "", alt: "" }
        : { type, text: "" };
    setDraft((current) => ({ ...current, blocks: [...current.blocks, block] }));
  }

  function removeBlock(index: number) {
    setDraft((current) => ({ ...current, blocks: current.blocks.filter((_block, blockIndex) => blockIndex !== index) }));
  }

  async function saveDraft() {
    setBusy(true);
    onError("");
    try {
      const input = {
        ...draft,
        blocks: draft.blocks.filter((block) =>
          block.type === "button" ? block.label.trim() && block.url.trim()
            : block.type === "image" ? block.url.trim()
              : block.text.trim(),
        ),
      };
      if (selected && selected.status === "draft") {
        const { campaign } = await updateNewsletterCampaign(recordId(selected), input);
        setSelectedId(recordId(campaign));
      } else {
        const { campaign } = await createNewsletterCampaign(input);
        setSelectedId(recordId(campaign));
      }
      setRefresh((value) => value + 1);
    } catch (reason) {
      onError(errorText(reason, "Could not save this campaign."));
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    if (!selected) return;
    try {
      onError("");
      const result = await previewNewsletterCampaign(recordId(selected));
      setPreview(result.html);
    } catch (reason) {
      onError(errorText(reason, "Could not render campaign preview."));
    }
  }

  async function sendTest() {
    if (!selected) return;
    setBusy(true);
    try {
      onError("");
      await sendNewsletterCampaignTest(recordId(selected), testEmail);
      setNotice("A test message was sent to the address provided.");
    } catch (reason) {
      onError(errorText(reason, "Could not send the campaign test."));
    } finally {
      setBusy(false);
    }
  }

  async function sendCampaignNow() {
    if (!selected || !window.confirm(`Send “${selected.subject}” to ${eligibleCount} eligible verified subscriber(s)? This cannot be undone.`)) return;
    setBusy(true);
    try {
      onError("");
      await sendNewsletterCampaign(recordId(selected));
      setRefresh((value) => value + 1);
    } catch (reason) {
      onError(errorText(reason, "The campaign could not be sent."));
      setRefresh((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div><h3 className="font-semibold text-slate-900">Campaigns</h3><p className="text-xs text-slate-500">{eligibleCount} eligible recipients</p></div>
          <button type="button" onClick={() => { setSelectedId(""); setDraft(EMPTY_CAMPAIGN); setPreview(""); onError(""); }} className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white"><Plus size={14} /> New</button>
        </div>
        {loading ? <p className="p-4 text-sm text-slate-500">Loading campaigns…</p> : (
          <div className="max-h-[650px] overflow-y-auto">
            {!campaigns.length && <p className="p-4 text-sm text-slate-500">No campaigns yet. Create a draft to get started.</p>}
            {campaigns.map((campaign) => (
              <button type="button" key={recordId(campaign)} onClick={() => { setSelectedId(recordId(campaign)); onError(""); }} className={`block w-full border-b border-slate-100 p-4 text-left ${recordId(campaign) === selectedId ? "bg-violet-50" : "hover:bg-slate-50"}`}>
                <span className="block truncate text-sm font-semibold text-slate-900">{campaign.name}</span>
                <span className="mt-1 block truncate text-xs text-slate-600">{campaign.subject}</span>
                <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600">{campaign.status}</span>
              </button>
            ))}
          </div>
        )}
      </aside>
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="font-semibold text-slate-900">{selected ? selected.status === "draft" ? "Edit campaign draft" : "Campaign details" : "Create a campaign"}</h3><p className="text-xs text-slate-500">Use the approved bakery template blocks; recipient-specific unsubscribe links are inserted automatically.</p></div>
          {selected && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{selected.status}</span>}
        </div>
        {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
        {(selected && selected.status !== "draft") && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            This campaign is {selected.status}. Campaign content is locked after sending begins.
            {selected.failureReason && <span className="mt-1 block">{selected.failureReason}</span>}
          </div>
        )}
        <fieldset disabled={Boolean(selected && selected.status !== "draft")} className="space-y-4 disabled:opacity-70">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">Internal campaign name<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={160} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="June bakery notes" /></label>
            <label className="text-xs font-medium text-slate-700">Email subject<input value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} maxLength={180} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="A fresh note from the bakery" /></label>
          </div>
          <label className="block text-xs font-medium text-slate-700">Inbox preview text<input value={draft.previewText} onChange={(event) => setDraft((current) => ({ ...current, previewText: event.target.value }))} maxLength={200} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" /></label>
          <label className="block text-xs font-medium text-slate-700">Introduction<textarea value={draft.intro} onChange={(event) => setDraft((current) => ({ ...current, intro: event.target.value }))} maxLength={2000} rows={3} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="A short welcome message…" /></label>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-800">Email content blocks</h4><div className="flex flex-wrap gap-1"><button type="button" onClick={() => addBlock("heading")} className="rounded-md border border-slate-200 px-2 py-1 text-xs">+ Heading</button><button type="button" onClick={() => addBlock("paragraph")} className="rounded-md border border-slate-200 px-2 py-1 text-xs">+ Text</button><button type="button" onClick={() => addBlock("button")} className="rounded-md border border-slate-200 px-2 py-1 text-xs">+ Button</button><button type="button" onClick={() => addBlock("image")} className="rounded-md border border-slate-200 px-2 py-1 text-xs">+ Image</button></div></div>
            {draft.blocks.map((block, index) => (
              <div key={`${block.type}-${index}`} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between text-xs font-semibold capitalize text-slate-700"><span>{block.type} block</span><button type="button" onClick={() => removeBlock(index)} className="text-rose-700 hover:underline">Remove</button></div>
                {(block.type === "heading" || block.type === "paragraph") && <textarea value={block.text} onChange={(event) => updateBlock(index, { text: event.target.value })} maxLength={2000} rows={block.type === "heading" ? 2 : 3} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" placeholder={block.type === "heading" ? "A concise section heading" : "Write the campaign message"} />}
                {block.type === "button" && <div className="grid gap-2 sm:grid-cols-2"><input value={block.label} onChange={(event) => updateBlock(index, { label: event.target.value })} maxLength={120} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Button label" /><input value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value })} maxLength={1000} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="https://…" /></div>}
                {block.type === "image" && <div className="grid gap-2 sm:grid-cols-2"><input value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value })} maxLength={1000} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="https://… image URL" /><input value={block.alt} onChange={(event) => updateBlock(index, { alt: event.target.value })} maxLength={250} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Accessible image description" /></div>}
              </div>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button type="button" disabled={busy || Boolean(selected && selected.status !== "draft")} onClick={() => void saveDraft()} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Working…" : "Save draft"}</button>
          {selected?.status === "draft" && <button type="button" onClick={() => void loadPreview()} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">Preview</button>}
          {selected?.status === "draft" && <button type="button" disabled={busy || !testEmail} onClick={() => void sendTest()} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Send test</button>}
          {selected?.status === "draft" && <button type="button" disabled={busy || eligibleCount === 0} onClick={() => void sendCampaignNow()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send size={15} /> Send to {eligibleCount}</button>}
        </div>
        {selected?.status === "draft" && <label className="block max-w-sm text-xs font-medium text-slate-700">Test recipient<input type="email" required value={testEmail} onChange={(event) => setTestEmail(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="your-email@example.com" /></label>}
        {preview && <div className="overflow-hidden rounded-xl border border-slate-200"><div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">Rendered email preview</div><iframe title="Newsletter campaign preview" sandbox="" srcDoc={preview} className="h-[620px] w-full bg-white" /></div>}
      </section>
    </div>
  );
}
