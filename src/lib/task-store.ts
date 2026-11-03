const g = (globalThis as any);
const tasks: Map<string, any> = g.__aiStudioTasks ?? new Map();
if (!g.__aiStudioTasks) g.__aiStudioTasks = tasks;
export function createTask(label?: string): string { const id=`task-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; const now=Date.now(); tasks.set(id,{id,status:"pending",createdAt:now,updatedAt:now,label}); return id; }
export function getTask(id: string) { return tasks.get(id) ?? null; }
export function updateTask(id: string, u: any) { const e=tasks.get(id); if(!e) return; tasks.set(id,{...e,...u,updatedAt:Date.now()}); }
export function cleanupOldTasks() { const t=Date.now()-600000; for(const [id,task] of tasks) if(task.updatedAt<t) tasks.delete(id); }
