import { createFileRoute } from "@tanstack/react-router";
import { GodsEyeView } from "@/components/gods-eye-view";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <GodsEyeView />;
}
