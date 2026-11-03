"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FolderOpen, Plus, X, Trash2, Clock, Check, Archive } from "lucide-react";
import { useSessionStore } from "@/stores/session-store";

interface P { section: string; onResetState: () => void; onRestoreState: (s: any) => void; getSnapshot: () => any; className?: string; }
export function SessionToolbar({ section, onResetState, onRestoreState, getSnapshot, className }: P) {
  const locale = useI18n(s => s.locale); const { toast } = useToast(); const isAr = locale === "ar";
  const sessions = useSessionStore(s => s.sessionsBySection[section] ?? []);
  const ns = useSessionStore(s => s.newSession); const cs = useSessionStore(s => s.closeSession); const rs = useSessionStore(s => s.reopenSession); const ds = useSessionStore(s => s.deleteSession); const us = useSessionStore(s => s.updateState);
  const [open, setOpen] = useState(false);
  const active = useMemo(() => sessions.find(s => s.status === "active") ?? null, [sessions]);
  const archived = useMemo(() => sessions.filter(s => s.status === "archived"), [sessions]);
  const activeId = active?.id;

  // Create initial session once
  useEffect(() => { if (!activeId) ns(section, {}); }, [section, activeId, ns]);

  // Save snapshot — BUT only when getSnapshot() returns a DIFFERENT value
  // than what's already stored. This prevents infinite update loops.
  const lastSnapshot = useRef<string>("");
  useEffect(() => {
    if (!activeId) return;
    const snap = getSnapshot();
    const snapStr = JSON.stringify(snap);
    if (snapStr !== lastSnapshot.current) {
      lastSnapshot.current = snapStr;
      us(section, snap);
    }
  }, [activeId, section, us, getSnapshot]);

  return (
    <div className={cn("relative flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/40 ring-1 ring-border text-xs", className)}>
      <div className="flex items-center gap-1.5 min-w-0"><span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" /><span className="truncate font-medium">{active?.title ?? (isAr ? "لا جلسة" : "No session")}</span></div>
      <div className="flex-1" />
      <button onClick={() => { ns(section, {}); onResetState(); toast({ title: isAr ? "جديدة" : "New" }); }} className="flex items-center gap-1 h-7 px-2 rounded text-[11px] bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30"><Plus className="h-3 w-3" /><span className="hidden sm:inline">{isAr ? "جديدة" : "New"}</span></button>
      <button onClick={() => { cs(section); onResetState(); toast({ title: isAr ? "أغلقت" : "Closed" }); }} className="flex items-center gap-1 h-7 px-2 rounded text-[11px] bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30"><X className="h-3 w-3" /><span className="hidden sm:inline">{isAr ? "إغلاق" : "Close"}</span></button>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 h-7 px-2 rounded text-[11px] bg-muted/60"><FolderOpen className="h-3 w-3" /><span className="hidden sm:inline">{isAr ? "الجلسات" : "Sessions"}</span>{archived.length > 0 && <span className="px-1 rounded-full bg-cyan-accent/20 text-cyan-accent text-[9px]">{archived.length}</span>}</button>
      {open && (<><div className="fixed inset-0 z-30" onClick={() => setOpen(false)} /><div className="absolute top-full right-0 mt-1 z-40 w-72 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"><div className="sticky top-0 bg-popover px-3 py-2 border-b text-[11px] font-semibold">{isAr ? "الجلسات" : "Sessions"} ({sessions.length})</div>{sessions.length === 0 ? <div className="p-4 text-center text-[11px] text-muted-foreground">{isAr ? "لا جلسات" : "None"}</div> : <div className="divide-y divide-border">{sessions.map(s => (<div key={s.id} className={cn("flex items-center gap-2 p-2 hover:bg-muted/40", s.status === "active" && "bg-cyan-accent/5")}>{s.status === "active" ? <Check className="h-3 w-3 text-emerald-500" /> : <Archive className="h-3 w-3 text-muted-foreground" />}<button onClick={() => { rs(section, s.id); onRestoreState(s.state); setOpen(false); }} className="flex-1 text-left"><div className="text-[11px] truncate">{s.title}</div><div className="text-[9px] text-muted-foreground"><Clock className="h-2 w-2 inline" /> {new Date(s.createdAt).toLocaleString()}</div></button>{s.status === "archived" && <button onClick={() => ds(section, s.id)} className="h-6 w-6 rounded hover:bg-red-500/20 text-red-400 flex items-center justify-center"><Trash2 className="h-3 w-3" /></button>}</div>))}</div>}</div></>)}
    </div>
  );
}
