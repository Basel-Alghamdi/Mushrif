"use client";

import type { ChatBlock } from "@rasd/schemas";
import { CircleCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import { useChat } from "../../../lib/chat/chat-context";

type AppliedBlockData = Extract<ChatBlock, { type: "applied" }>;

export function AppliedBlock({ block, conversationId, messageId }: { block: AppliedBlockData; conversationId: string; messageId: string }) {
  const { undoApplied } = useChat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const undo = async () => {
    if (!block.undoProposalId) return;
    setBusy(true);
    setError("");
    try { await undoApplied(conversationId, messageId, block.undoProposalId); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section className="blk blk-applied">
      <CircleCheck aria-hidden className="blk-applied-icon" />
      <p>{block.text}</p>
      {block.undoProposalId && (
        <button className="btn btn-secondary btn-sm" onClick={undo} disabled={busy}>
          {busy ? <span className="spinner" /> : <Undo2 />} تراجع
        </button>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
