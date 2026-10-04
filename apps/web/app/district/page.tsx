"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ChatView } from "../../components/chat/chat-view";

/** /district — a new conversation. `?q=` prefills the composer, `&send=1` sends it right away. */
function NewChat() {
  const router = useRouter();
  const params = useSearchParams();
  const [initial] = useState(() => ({ text: params.get("q") ?? "", send: params.get("send") === "1" }));

  useEffect(() => {
    if (params.get("q")) router.replace("/district", { scroll: false });
  }, [params, router]);

  return <ChatView conversationId={null} initialText={initial.text} sendInitial={initial.send} />;
}

export default function NewChatPage() {
  return <Suspense fallback={null}><NewChat /></Suspense>;
}
