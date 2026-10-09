import type { Metadata } from "next";
import CopilotChat from "@/components/CopilotChat";

export const metadata: Metadata = { title: "Copilot" };

export default function CopilotPage() {
  return <CopilotChat />;
}
