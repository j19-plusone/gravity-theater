import { createFileRoute } from "@tanstack/react-router";
import { Orrery } from "@/components/orrery/Orrery";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Orrery />;
}
