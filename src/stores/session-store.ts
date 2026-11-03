"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
export interface Session { id: string; title: string; createdAt: number; updatedAt: number; state: any; status: "active" | "archived"; }
interface S { sessionsBySection: Record<string, Session[]>; newSession: (s: string, i?: any) => string; updateState: (s: string, st: any) => void; closeSession: (s: string) => void; reopenSession: (s: string, id: string) => void; deleteSession: (s: string, id: string) => void; renameSession: (s: string, id: string, t: string) => void; getActiveSession: (s: string) => Session | null; getSessions: (s: string) => Session[]; getArchivedCount: (s: string) => number; resetSection: (s: string) => void; }
const nid = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const ntitle = (s: string) => `Session ${new Date().toLocaleString()}`;
export const useSessionStore = create<S>()(persist((set,get) => ({
  sessionsBySection: {},
  newSession: (section,init) => { const id=nid(),now=Date.now(); const sess={id,title:ntitle(section),createdAt:now,updatedAt:now,state:init??{},status:"active" as const}; set(s => { const ex=s.sessionsBySection[section]??[]; const ar=ex.map(e=>e.status==="active"?{...e,status:"archived" as const}:e); return {sessionsBySection:{...s.sessionsBySection,[section]:[sess,...ar]}}; }); return id; },
  updateState: (section,state) => { set(s => { const l=s.sessionsBySection[section]??[]; if(!l.length){const id=nid(),now=Date.now(); return {sessionsBySection:{...s.sessionsBySection,[section]:[{id,title:ntitle(section),createdAt:now,updatedAt:now,state,status:"active" as const}]}};} return {sessionsBySection:{...s.sessionsBySection,[section]:l.map((e,i)=>i===0?{...e,state,updatedAt:Date.now()}:e)}}; }); },
  closeSession: (section) => { set(s => { const l=s.sessionsBySection[section]??[]; const ar=l.map(e=>e.status==="active"?{...e,status:"archived" as const}:e); const id=nid(),now=Date.now(); return {sessionsBySection:{...s.sessionsBySection,[section]:[{id,title:ntitle(section),createdAt:now,updatedAt:now,state:{},status:"active" as const},...ar]}}; }); },
  reopenSession: (section,sessionId) => { set(s => { const l=s.sessionsBySection[section]??[]; const t=l.find(e=>e.id===sessionId); if(!t) return s; const ro=[t,...l.filter(e=>e.id!==sessionId)].map(e=>e.id===sessionId?{...e,status:"active" as const}:e.status==="active"?{...e,status:"archived" as const}:e); return {sessionsBySection:{...s.sessionsBySection,[section]:ro}}; }); },
  deleteSession: (section,sessionId) => { set(s => ({sessionsBySection:{...s.sessionsBySection,[section]:(s.sessionsBySection[section]??[]).filter(e=>e.id!==sessionId)}})); },
  renameSession: (section,sessionId,title) => { set(s => ({sessionsBySection:{...s.sessionsBySection,[section]:(s.sessionsBySection[section]??[]).map(e=>e.id===sessionId?{...e,title,updatedAt:Date.now()}:e)}})); },
  getActiveSession: (section) => (get().sessionsBySection[section]??[]).find(e=>e.status==="active")??null,
  getSessions: (section) => get().sessionsBySection[section]??[],
  getArchivedCount: (section) => (get().sessionsBySection[section]??[]).filter(e=>e.status==="archived").length,
  resetSection: (section) => set(s => ({sessionsBySection:{...s.sessionsBySection,[section]:[]}})),
}), { name: "ai-studio-sessions", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ sessionsBySection: s.sessionsBySection }) }));
