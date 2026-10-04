import type { ChatBlock } from "@rasd/schemas";
import { AppliedBlock } from "./applied-block";
import { ChoicesBlock } from "./choices-block";
import { CopyBlock } from "./copy-block";
import { DocumentsBlock } from "./documents-block";
import { MemberBlock } from "./member-block";
import { ProposalBlock } from "./proposal-block";
import { StatsBlock } from "./stats-block";
import { TableBlock } from "./table-block";

type Props = {
  block: ChatBlock;
  conversationId: string;
  messageId: string;
  /** The message's own text, so a block doesn't repeat a sentence that is already said above it. */
  messageText: string;
  onSend: (text: string) => void;
  busy: boolean;
};

/** Renders one structured block of an assistant message. Unknown block types are skipped. */
export function BlockView({ block, conversationId, messageId, messageText, onSend, busy }: Props) {
  switch (block.type) {
    case "stats": return <StatsBlock block={block} />;
    case "table": return <TableBlock block={block} />;
    case "member": return <MemberBlock block={block} />;
    case "choices": return <ChoicesBlock block={block} onSend={onSend} disabled={busy} />;
    case "proposal": return <ProposalBlock block={block} conversationId={conversationId} messageId={messageId} messageText={messageText} />;
    case "copy": return <CopyBlock block={block} />;
    case "documents": return <DocumentsBlock block={block} />;
    case "applied": return <AppliedBlock block={block} conversationId={conversationId} messageId={messageId} />;
    default: return null;
  }
}
