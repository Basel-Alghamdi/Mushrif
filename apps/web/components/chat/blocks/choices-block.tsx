import type { ChatBlock } from "@rasd/schemas";

type ChoicesBlockData = Extract<ChatBlock, { type: "choices" }>;

export function ChoicesBlock({ block, onSend, disabled }: { block: ChoicesBlockData; onSend: (text: string) => void; disabled: boolean }) {
  return (
    <section className="blk blk-choices">
      {block.prompt && <p className="blk-note">{block.prompt}</p>}
      <div className="blk-chips">
        {block.options.map((option, index) => (
          <button key={index} className="chip" onClick={() => onSend(option.message)} disabled={disabled}>{option.label}</button>
        ))}
      </div>
    </section>
  );
}
