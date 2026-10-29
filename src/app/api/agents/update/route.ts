import { NextRequest, NextResponse } from "next/server";
import {
  updateAgent,
  setAgentEnabled,
  addAgentTask,
  removeAgentTask,
  type AgentId,
  type Agent,
} from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/update
 *
 * Update an agent's config / schedule / tasks / status.
 *
 * Body:
 *   {
 *     agentId: AgentId,
 *     action: "edit" | "toggle" | "add-task" | "remove-task",
 *     patch?: Partial<Agent>,    // for "edit"
 *     taskText?: string,           // for "add-task"
 *     taskId?: string,             // for "remove-task"
 *     enabled?: boolean,           // for "toggle"
 *   }
 *
 * When the user EDITS or ADDS a task, the agent ADAPTS to the new task
 * automatically — the registry stores the new tasks/schedule/config and
 * the agent runs use them on the next tick.
 */
export async function POST(req: NextRequest) {
  let body: {
    agentId?: AgentId;
    action: "edit" | "toggle" | "add-task" | "remove-task";
    patch?: Partial<Agent>;
    taskText?: string;
    taskId?: string;
    enabled?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.agentId || !body.action) {
    return NextResponse.json(
      { error: "Missing agentId or action" },
      { status: 400 }
    );
  }

  try {
    let updated: Agent | null = null;

    switch (body.action) {
      case "edit": {
        if (!body.patch) {
          return NextResponse.json(
            { error: "Missing patch for edit action" },
            { status: 400 }
          );
        }
        const { id: _ignored, ...safePatch } = body.patch;
        updated = updateAgent(body.agentId, safePatch as Partial<Agent>);
        break;
      }
      case "toggle": {
        if (typeof body.enabled !== "boolean") {
          return NextResponse.json(
            { error: "Missing enabled (boolean) for toggle action" },
            { status: 400 }
          );
        }
        updated = setAgentEnabled(body.agentId, body.enabled);
        break;
      }
      case "add-task": {
        if (!body.taskText?.trim()) {
          return NextResponse.json(
            { error: "Missing taskText for add-task action" },
            { status: 400 }
          );
        }
        updated = addAgentTask(body.agentId, body.taskText.trim());
        break;
      }
      case "remove-task": {
        if (!body.taskId) {
          return NextResponse.json(
            { error: "Missing taskId for remove-task action" },
            { status: 400 }
          );
        }
        updated = removeAgentTask(body.agentId, body.taskId);
        break;
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }

    if (!updated) {
      return NextResponse.json(
        { error: `Agent not found: ${body.agentId}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, agent: updated });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
