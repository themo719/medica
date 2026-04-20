import { ChatShell } from "@/components/chat-shell";
import { getFeaturedKnowledge, getKnowledgeStats } from "@/lib/knowledge";
import { isLiveModelConfigured } from "@/lib/chat";

export default async function HomePage() {
  const [featuredDocs, knowledgeStats] = await Promise.all([getFeaturedKnowledge(6), getKnowledgeStats()]);

  return (
    <main className="page-shell">
      <ChatShell
        featuredDocs={featuredDocs}
        knowledgeSnapshot={knowledgeStats}
        liveModelReady={isLiveModelConfigured()}
      />
    </main>
  );
}
